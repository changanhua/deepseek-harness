/**
 * Host ArkCLI implementation of the image generation provider seam.
 * @module @deepseek-ai/dsh-image-generation-arkcli
 */

import { chmod, lstat, mkdtemp, readFile, readdir, rmdir, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  GeneratedImage,
  ImageGenerationContext,
  ImageGenerationInput,
  ImageGenerationProvider,
  ImageGenerationProviderSpec,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageOutputFormat,
} from '@deepseek-ai/dsh-image-generation'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import sharp from 'sharp'

/** Stable provider id registered with the shared image generation service. */
export const ARKCLI_IMAGE_GENERATION_PROVIDER_ID = 'arkcli'

/** Failure classes exposed by the ArkCLI provider. */
export type ArkcliImageGenerationErrorCategory =
  | 'rate-limit'
  | 'transport'
  | 'authentication'
  | 'policy'
  | 'invalid-input'
  | 'provider'

/** Whether an image generation side effect is known to have begun. */
export type ArkcliImageGenerationSideEffect = 'not-started' | 'started' | 'unknown'

/** Provider failure carrying retry-relevant facts without making a retry decision. */
export class ArkcliImageGenerationError extends Error {
  /** Provider failure class. */
  readonly category: ArkcliImageGenerationErrorCategory
  /** Best available generation side-effect evidence. */
  readonly sideEffect: ArkcliImageGenerationSideEffect
  /** Whether a later caller-authorized retry may succeed. */
  readonly retriable: boolean

  /**
   * Create a sanitized provider failure.
   * @param message - non-sensitive diagnostic summary.
   * @param category - stable provider failure class.
   * @param sideEffect - best available generation side-effect evidence.
   * @param retriable - whether the condition may succeed later.
   * @param options - optional internal cause, never included in the message.
   */
  constructor(
    message: string,
    category: ArkcliImageGenerationErrorCategory,
    sideEffect: ArkcliImageGenerationSideEffect,
    retriable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ArkcliImageGenerationError'
    this.category = category
    this.sideEffect = sideEffect
    this.retriable = retriable
  }
}

/** Deployment limits for ArkCLI process output and decoded image resources. */
export interface Config {
  /** ArkCLI executable name or absolute host path. */
  executable?: string
  /** Fixed arguments placed before every ArkCLI subcommand, for host launchers such as `node.exe arkcli.js`. */
  argvPrefix?: string[]
  /** Maximum complete stdout bytes accepted from one ArkCLI invocation. */
  stdoutMaxBytes?: number
  /** Maximum stderr tail bytes retained for private failure classification. */
  stderrMaxBytes?: number
  /** Process-tree termination grace passed to the subprocess service. */
  graceMs?: number
  /** Bound for each process-tree quiescence probe after exit or cancellation. */
  quiescenceTimeoutMs?: number
  /** Maximum encoded bytes read from the generated file. */
  maxImageBytes?: number
  /** Maximum decoded pixels accepted from the generated image. */
  maxImagePixels?: number
  /** Minimum requested image pixels admitted before generation. */
  minImagePixels?: number
  /** Minimum admitted width-to-height ratio. */
  minAspectRatio?: number
  /** Maximum admitted width-to-height ratio. */
  maxAspectRatio?: number
}

const DEFAULT_STDOUT_MAX_BYTES = 64 * 1024
const DEFAULT_STDERR_MAX_BYTES = 16 * 1024
const DEFAULT_GRACE_MS = 1_000
const DEFAULT_QUIESCENCE_TIMEOUT_MS = 5_000
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const DEFAULT_MIN_IMAGE_PIXELS = 3_686_400
const DEFAULT_MAX_IMAGE_PIXELS = 16_777_216
const DEFAULT_MIN_ASPECT_RATIO = 1 / 16
const DEFAULT_MAX_ASPECT_RATIO = 16

/** ArkCLI provider configuration schema. */
export const Config: z<Config> = z.object({
  executable: z.string().default('arkcli'),
  argvPrefix: z.array(z.string()).default([]),
  stdoutMaxBytes: z.number().default(DEFAULT_STDOUT_MAX_BYTES),
  stderrMaxBytes: z.number().default(DEFAULT_STDERR_MAX_BYTES),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
  quiescenceTimeoutMs: z.number().default(DEFAULT_QUIESCENCE_TIMEOUT_MS),
  maxImageBytes: z.number().default(DEFAULT_MAX_IMAGE_BYTES),
  maxImagePixels: z.number().default(DEFAULT_MAX_IMAGE_PIXELS),
  minImagePixels: z.number().default(DEFAULT_MIN_IMAGE_PIXELS),
  minAspectRatio: z.number().default(DEFAULT_MIN_ASPECT_RATIO),
  maxAspectRatio: z.number().default(DEFAULT_MAX_ASPECT_RATIO),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'image-generation-arkcli'
/** Services required by the host ArkCLI provider. */
export const inject = ['imageGeneration', 'subprocess']

type ResolvedConfig = Required<Config>
type JsonRecord = Record<string, unknown>

interface ResolvedProfile {
  readonly name: string
  readonly type: 'agent-plan' | 'agent-plan-team'
}

interface ArkcliProviderFacts {
  readonly profile: ResolvedProfile
  readonly canonicalModel: string
  readonly parameters: {
    readonly size: string
    readonly outputFormat: ImageOutputFormat
    readonly watermark: boolean
  }
}

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

interface FailureClass {
  readonly category: ArkcliImageGenerationErrorCategory
  readonly retriable: boolean
}

const ARKCLI_ENV = {
  ARKCLI_CALLER_TYPE: 'ai_agent',
  ARKCLI_CALLER_NAME: 'deepseek-harness',
  ARKCLI_SKILL_NAME: 'arkcli-gen',
} as const

/** Assert one configured count or byte cap is a positive integer. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`image-generation-arkcli: ${name} must be a positive integer`)
  }
}

/** Narrow an unknown JSON value to a non-array object. */
function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

/** Read a required nonblank string field. */
function stringField(value: JsonRecord, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined
}

/** Construct a sanitized provider failure. */
function failure(
  message: string,
  category: ArkcliImageGenerationErrorCategory,
  sideEffect: ArkcliImageGenerationSideEffect,
  retriable: boolean,
  cause?: unknown,
): ArkcliImageGenerationError {
  return new ArkcliImageGenerationError(message, category, sideEffect, retriable, cause === undefined ? undefined : { cause })
}

/** Classify private CLI diagnostics without copying them into public errors. */
function classifyDiagnostics(stderr: string): FailureClass {
  if (/429|too\s*many\s*requests|rate.?limit/i.test(stderr)) return { category: 'rate-limit', retriable: true }
  if (/401|403|unauthori[sz]ed|authentication|invalid[_ -]?api[_ -]?key|access.?denied/i.test(stderr)) {
    return { category: 'authentication', retriable: false }
  }
  if (/content.?risk|sensitive.?content|policy|copyright|moderation/i.test(stderr)) {
    return { category: 'policy', retriable: false }
  }
  if (/invalid.?parameter|invalid.?input|validation|param.?not.?supported/i.test(stderr)) {
    return { category: 'invalid-input', retriable: false }
  }
  if (/econnreset|econnrefused|etimedout|timeout|timed out|connection|network|dns|socket/i.test(stderr)) {
    return { category: 'transport', retriable: true }
  }
  return { category: 'provider', retriable: false }
}

/** Read mutable abort state without preserving a stale control-flow narrowing across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Require a complete collected stream and reject lossy output. */
function completeOutput(output: SubprocessOutputRead | undefined, stream: 'stdout' | 'stderr', sideEffect: ArkcliImageGenerationSideEffect): string {
  if (output === undefined || output.lossy) {
    throw failure(`ArkCLI ${stream} was unavailable or exceeded its configured capture limit`, 'provider', sideEffect, false)
  }
  return output.text
}

/** Wait for a process tree with a fresh timeout signal, then force an unbounded final reap if needed. */
async function awaitQuiescence(
  handle: SubprocessHandle,
  timeoutMs: number,
  phase: 'admission' | 'generation',
): Promise<void> {
  let quiet = false
  try {
    quiet = await handle.waitForExit(AbortSignal.timeout(timeoutMs))
  } catch {
    // A failed bounded probe cannot establish quiescence; force the final reap below.
  }
  if (quiet) return
  handle.terminate()
  await handle.waitForExit()
  throw failure(
    'ArkCLI process tree exceeded its quiescence deadline and was forcibly reaped',
    'transport',
    phase === 'generation' ? 'unknown' : 'not-started',
    true,
  )
}

/** Execute one bounded, non-spilling ArkCLI command. */
async function runArkcli(
  ctx: Context,
  config: ResolvedConfig,
  args: readonly string[],
  signal: AbortSignal | undefined,
  phase: 'admission' | 'generation',
): Promise<CommandResult> {
  if (isAborted(signal)) {
    throw failure('ArkCLI invocation was canceled before process start', 'transport', 'not-started', true, signal?.reason)
  }
  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [config.executable, ...config.argvPrefix, ...args],
      cwd: process.cwd(),
      env: ARKCLI_ENV,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: config.stdoutMaxBytes },
        stderr: { maxBytes: config.stderrMaxBytes },
      },
      graceMs: config.graceMs,
      signal,
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    throw failure('ArkCLI process could not be started', 'transport', 'not-started', true, error)
  }
  const abort = Promise.withResolvers<'aborted'>()
  const onAbort = (): void => {
    handle.terminate()
    abort.resolve('aborted')
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  let outcome: Awaited<SubprocessHandle['done']>
  try {
    const settled = await Promise.race([
      handle.done.then(
        value => ({ kind: 'done' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      ),
      abort.promise.then(() => ({ kind: 'aborted' as const })),
    ])
    if (settled.kind === 'aborted') {
      await awaitQuiescence(handle, config.quiescenceTimeoutMs, phase)
      throw failure(
        'ArkCLI process was canceled before completion',
        'transport',
        phase === 'generation' ? 'unknown' : 'not-started',
        true,
        signal?.reason,
      )
    }
    if (settled.kind === 'error') {
      await awaitQuiescence(handle, config.quiescenceTimeoutMs, phase)
      const sideEffect = phase === 'generation' && handle.pid !== -1 ? 'unknown' : 'not-started'
      throw failure('ArkCLI process failed before producing an exit outcome', 'transport', sideEffect, true, settled.error)
    }
    outcome = settled.value
    await awaitQuiescence(handle, config.quiescenceTimeoutMs, phase)
  } catch (error: unknown) {
    if (error instanceof ArkcliImageGenerationError) throw error
    handle.terminate()
    try {
      await awaitQuiescence(handle, config.quiescenceTimeoutMs, phase)
    } catch {
      // awaitQuiescence already performed the unbounded final reap.
    }
    throw failure(
      'ArkCLI process lifecycle failed',
      'transport',
      phase === 'generation' ? 'unknown' : 'not-started',
      true,
      error,
    )
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  const stdoutRead = handle.collected.stdout?.readFrom(0)
  const stderrRead = handle.collected.stderr?.readFrom(0)
  const sideEffect = phase === 'generation' ? 'unknown' : 'not-started'
  const stdout = completeOutput(stdoutRead, 'stdout', sideEffect)
  const stderr = completeOutput(stderrRead, 'stderr', sideEffect)
  if (isAborted(signal) || outcome.signal !== null || outcome.exitCode === null) {
    throw failure('ArkCLI process was canceled or terminated before completion', 'transport', sideEffect, true, signal?.reason)
  }
  if (outcome.exitCode !== 0) {
    const classified = classifyDiagnostics(stderr)
    throw failure('ArkCLI command was rejected or failed', classified.category, sideEffect, classified.retriable)
  }
  return { stdout, stderr }
}

/** Parse one complete ArkCLI JSON response without echoing sensitive text. */
function parseJson(text: string, phase: 'admission' | 'generation', sideEffect: ArkcliImageGenerationSideEffect): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    throw failure(`ArkCLI returned malformed JSON during ${phase}`, 'provider', sideEffect, false, error)
  }
}

/** Resolve and validate the active plan profile. */
function parseProfile(value: unknown): ResolvedProfile {
  const profile = record(value)
  const name = profile === undefined ? undefined : stringField(profile, 'name')
  const type = profile === undefined ? undefined : stringField(profile, 'type')
  if (name === undefined || type === undefined) {
    throw failure('ArkCLI profile response omitted a stable name or type', 'provider', 'not-started', false)
  }
  if (type !== 'agent-plan' && type !== 'agent-plan-team') {
    throw failure('ArkCLI image generation requires an Agent Plan profile', 'authentication', 'not-started', false)
  }
  return { name, type }
}

/** Select one currently invocable image resource. */
function selectResource(value: unknown, explicitModel: string | undefined): string {
  const response = record(value)
  const itemsValue = response?.items
  if (!Array.isArray(itemsValue)) {
    throw failure('ArkCLI resource response omitted its item list', 'provider', 'not-started', false)
  }
  const items = itemsValue.flatMap((item): JsonRecord[] => {
    const parsed = record(item)
    return parsed === undefined ? [] : [parsed]
  })
  const invocable = items.filter(item => item.invocable === true && stringField(item, 'id') !== undefined)
  if (explicitModel !== undefined) {
    const selected = invocable.find(item => stringField(item, 'id') === explicitModel)
    if (selected === undefined) {
      throw failure('Requested ArkCLI image model is not currently invocable', 'invalid-input', 'not-started', false)
    }
    return explicitModel
  }
  const currentDefault = response === undefined ? undefined : stringField(response, 'current_default')
  const defaults = invocable.filter(item => item.is_default === true || stringField(item, 'id') === currentDefault)
  const defaultId = defaults.length === 1 && defaults[0] !== undefined ? stringField(defaults[0], 'id') : undefined
  if (defaultId !== undefined) return defaultId
  const soleId = defaults.length === 0 && invocable.length === 1 && invocable[0] !== undefined
    ? stringField(invocable[0], 'id')
    : undefined
  if (soleId !== undefined) return soleId
  throw failure('ArkCLI image model selection is ambiguous', 'invalid-input', 'not-started', false)
}

/** Find one supported ArkCLI parameter by CLI/JSON spelling. */
function supportedParameter(params: readonly unknown[], names: readonly string[]): JsonRecord | undefined {
  return params
    .flatMap((value): JsonRecord[] => {
      const parsed = record(value)
      return parsed === undefined ? [] : [parsed]
    })
    .find(param => names.includes(stringField(param, 'name') ?? ''))
}

/** Verify one requested value against the model's explicit parameter catalog. */
function validateParameter(
  params: readonly unknown[],
  names: readonly string[],
  value: string | boolean,
  acceptedTypes: readonly string[],
): void {
  const parameter = supportedParameter(params, names)
  if (parameter === undefined || parameter.support !== true) {
    throw failure(`ArkCLI model does not support required parameter ${names[0]}`, 'invalid-input', 'not-started', false)
  }
  const enumValues = parameter.enum
  if (Array.isArray(enumValues) && !enumValues.some(candidate => candidate === value)) {
    throw failure(`ArkCLI model rejects requested value for ${names[0]}`, 'invalid-input', 'not-started', false)
  }
  if (!acceptedTypes.includes(stringField(parameter, 'type') ?? '')) {
    throw failure(`ArkCLI parameter ${names[0]} has an incompatible type`, 'invalid-input', 'not-started', false)
  }
}

/** Validate the parameter response and return durable provider facts. */
function parseProviderFacts(
  value: unknown,
  profile: ResolvedProfile,
  canonicalModel: string,
  request: ImageGenerationRequest,
  config: ResolvedConfig,
): ArkcliProviderFacts {
  if (!Array.isArray(value)) {
    throw failure('ArkCLI model parameter response was not an array', 'provider', 'not-started', false)
  }
  if (!/^[1-9]\d*x[1-9]\d*$/u.test(request.size)) {
    throw failure('Requested image size must be WIDTHxHEIGHT with positive integers', 'invalid-input', 'not-started', false)
  }
  const dimensions = expectedDimensions(request.size)
  const pixels = dimensions.width * dimensions.height
  const aspectRatio = dimensions.width / dimensions.height
  if (pixels < config.minImagePixels || pixels > config.maxImagePixels) {
    throw failure('Requested image size is outside the configured pixel limits', 'invalid-input', 'not-started', false)
  }
  if (aspectRatio < config.minAspectRatio || aspectRatio > config.maxAspectRatio) {
    throw failure('Requested image aspect ratio is outside the configured limits', 'invalid-input', 'not-started', false)
  }
  validateParameter(value, ['size'], request.size, ['string'])
  validateParameter(value, ['output_format', 'output-format'], request.outputFormat, ['enum', 'string'])
  validateParameter(value, ['watermark'], request.watermark, ['boolean'])
  return {
    profile,
    canonicalModel,
    parameters: { size: request.size, outputFormat: request.outputFormat, watermark: request.watermark },
  }
}

/** Validate persisted provider facts before starting a generation side effect. */
function persistedFacts(input: ImageGenerationInput): ArkcliProviderFacts {
  const facts = record(input.spec.providerSpec)
  const profile = record(facts?.profile)
  const parameters = record(facts?.parameters)
  const profileName = profile === undefined ? undefined : stringField(profile, 'name')
  const profileType = profile === undefined ? undefined : stringField(profile, 'type')
  const model = facts === undefined ? undefined : stringField(facts, 'canonicalModel')
  if (profileName === undefined
    || (profileType !== 'agent-plan' && profileType !== 'agent-plan-team')
    || model === undefined
    || parameters?.size !== input.spec.size
    || parameters.outputFormat !== input.spec.outputFormat
    || parameters.watermark !== input.spec.watermark
    || model !== input.spec.model) {
    throw failure('Persisted ArkCLI provider facts are invalid or inconsistent', 'invalid-input', 'not-started', false)
  }
  return {
    profile: { name: profileName, type: profileType },
    canonicalModel: model,
    parameters: {
      size: input.spec.size,
      outputFormat: input.spec.outputFormat,
      watermark: input.spec.watermark,
    },
  }
}

/** Return the exact expected pixel dimensions from an admitted size. */
function expectedDimensions(size: string): { width: number; height: number } {
  const [width, height] = size.split('x').map(Number)
  if (width === undefined || height === undefined || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw failure('Persisted ArkCLI image size is invalid', 'invalid-input', 'not-started', false)
  }
  return { width, height }
}

/** Fully decode and verify one generated PNG or JPEG while preserving its original bytes. */
async function decodeGeneratedImage(path: string, facts: ArkcliProviderFacts, config: ResolvedConfig): Promise<GeneratedImage> {
  const file = await stat(path)
  if (!file.isFile() || file.size > config.maxImageBytes) {
    throw failure('ArkCLI generated file is not a regular file within the configured byte limit', 'provider', 'started', false)
  }
  const bytes = await readFile(path)
  let decoded
  try {
    decoded = await sharp(bytes, { failOn: 'error', limitInputPixels: config.maxImagePixels })
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch (error: unknown) {
    throw failure('ArkCLI generated file could not be fully decoded', 'provider', 'started', false, error)
  }
  const sourceFormat = await sharp(bytes, { failOn: 'error', limitInputPixels: config.maxImagePixels }).metadata()
  const actualFormat = sourceFormat.format
  const expected = expectedDimensions(facts.parameters.size)
  if (actualFormat !== facts.parameters.outputFormat
    || decoded.info.width !== expected.width
    || decoded.info.height !== expected.height) {
    throw failure('ArkCLI generated image format or dimensions differ from the admitted request', 'provider', 'started', false)
  }
  return {
    bytes: new Uint8Array(bytes),
    mediaType: `image/${facts.parameters.outputFormat}`,
    width: decoded.info.width,
    height: decoded.info.height,
  }
}

/** Remove one private-tree entry without following a child-created link or junction. */
async function removeEntryNoFollow(path: string): Promise<void> {
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      await unlink(path)
      return
    }
    const children = await readdir(path)
    for (const child of children) await removeEntryNoFollow(join(path, child))
    const current = await lstat(path)
    if (current.isSymbolicLink() || !current.isDirectory()) {
      await unlink(path)
      return
    }
    await rmdir(path)
  } catch (error: unknown) {
    if (record(error)?.code !== 'ENOENT') throw error
  }
}

/** Host ArkCLI provider. Discovery occurs only in resolve; generation consumes persisted facts. */
class ArkcliImageGenerationProvider implements ImageGenerationProvider {
  readonly id = ARKCLI_IMAGE_GENERATION_PROVIDER_ID
  private readonly lifecycle = new AbortController()
  private readonly active = new Set<Promise<unknown>>()

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  resolve(request: ImageGenerationRequest, context: ImageGenerationContext): Promise<ImageGenerationProviderSpec> {
    return this.track(context.signal, signal => this.resolveOwned(request, signal), 'admission')
  }

  generate(input: ImageGenerationInput, context: ImageGenerationContext): Promise<ImageGenerationResult> {
    return this.track(context.signal, signal => this.generateOwned(input, signal), 'generation')
  }

  /** Abort every admitted operation and wait until all operation cleanup settles. */
  async dispose(): Promise<void> {
    this.lifecycle.abort(new Error('ArkCLI image generation provider disposed'))
    await Promise.allSettled(this.active)
  }

  /** Track one operation under the provider lifecycle signal. */
  private track<T>(
    callerSignal: AbortSignal | undefined,
    start: (signal: AbortSignal) => Promise<T>,
    phase: 'admission' | 'generation',
  ): Promise<T> {
    if (this.lifecycle.signal.aborted) {
      return Promise.reject(failure(
        'ArkCLI image generation provider is disposed',
        'transport',
        'not-started',
        true,
        this.lifecycle.signal.reason,
      ))
    }
    const signal = callerSignal === undefined
      ? this.lifecycle.signal
      : AbortSignal.any([callerSignal, this.lifecycle.signal])
    const operation = start(signal)
    this.active.add(operation)
    const retire = (): void => { this.active.delete(operation) }
    void operation.then(retire, retire)
    return operation.catch((error: unknown) => {
      if (error instanceof ArkcliImageGenerationError) throw error
      throw failure(
        `ArkCLI ${phase} failed in the host provider`,
        'provider',
        'not-started',
        false,
        error,
      )
    })
  }

  /** Perform one complete admission against the current profile. */
  private async resolveOwned(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageGenerationProviderSpec> {
    const profileRun = await runArkcli(this.ctx, this.config, ['profile', 'show', '--format', 'json'], signal, 'admission')
    const profile = parseProfile(parseJson(profileRun.stdout, 'admission', 'not-started'))
    const resourcesRun = await runArkcli(this.ctx, this.config, [
      'resources', 'list', '--profile', profile.name, '--modality', 'image', '--format', 'json',
    ], signal, 'admission')
    const resource = selectResource(parseJson(resourcesRun.stdout, 'admission', 'not-started'), request.model)
    const paramsRun = await runArkcli(this.ctx, this.config, [
      'models', 'get', resource, '--profile', profile.name, '--transform', 'supported_params', '--format', 'json',
    ], signal, 'admission')
    const facts = parseProviderFacts(
      parseJson(paramsRun.stdout, 'admission', 'not-started'),
      profile,
      resource,
      request,
      this.config,
    )
    return {
      model: facts.canonicalModel,
      size: facts.parameters.size,
      outputFormat: facts.parameters.outputFormat,
      watermark: facts.parameters.watermark,
      providerSpec: facts,
    }
  }

  /** Generate from persisted facts without performing discovery. */
  private async generateOwned(input: ImageGenerationInput, signal: AbortSignal): Promise<ImageGenerationResult> {
    const facts = persistedFacts(input)
    if (isAborted(signal)) {
      throw failure('ArkCLI generation was canceled before process start', 'transport', 'not-started', true, signal.reason)
    }
    let directory: string | undefined
    let primaryError: ArkcliImageGenerationError | undefined
    let completedProcess = false
    try {
      directory = await mkdtemp(join(tmpdir(), 'dsh-arkcli-image-'))
      await chmod(directory, 0o700)
      let run: CommandResult
      try {
        run = await runArkcli(this.ctx, this.config, [
          '+gen',
          '--profile', facts.profile.name,
          '--model', facts.canonicalModel,
          '--modality', 'image',
          '--size', facts.parameters.size,
          '--output-format', facts.parameters.outputFormat,
          `--watermark=${String(facts.parameters.watermark)}`,
          '--save-to', directory,
          '--no-open',
          '--format', 'json',
          input.prompt,
        ], signal, 'generation')
        completedProcess = true
      } catch (error: unknown) {
        if (!(error instanceof ArkcliImageGenerationError)) throw error
        let entries: string[]
        try {
          entries = await readdir(directory)
        } catch (inspectionError: unknown) {
          throw failure(
            'ArkCLI output directory could not be inspected after process failure',
            'provider',
            error.sideEffect,
            false,
            inspectionError,
          )
        }
        if (entries.length > 0 && error.sideEffect !== 'not-started') {
          throw failure(error.message, error.category, 'started', error.retriable, error)
        }
        throw error
      }
      const entries = await readdir(directory, { withFileTypes: true })
      parseJson(run.stdout, 'generation', entries.length > 0 ? 'started' : 'unknown')
      if (entries.length !== 1 || entries[0]?.isFile() !== true) {
        throw failure(
          'ArkCLI generation must produce exactly one regular file',
          'provider',
          entries.length === 0 ? 'unknown' : 'started',
          false,
        )
      }
      const image = await decodeGeneratedImage(join(directory, entries[0].name), facts, this.config)
      return { provider: this.id, model: facts.canonicalModel, images: [image] }
    } catch (error: unknown) {
      primaryError = error instanceof ArkcliImageGenerationError
        ? error
        : failure(
          'ArkCLI generation failed in host file or image processing',
          'provider',
          completedProcess ? 'started' : 'not-started',
          false,
          error,
        )
      throw primaryError
    } finally {
      if (directory !== undefined) {
        try {
          await removeEntryNoFollow(directory)
        } catch (error: unknown) {
          if (primaryError === undefined) {
            throw failure(
              'ArkCLI private output cleanup failed',
              'provider',
              completedProcess ? 'started' : 'not-started',
              false,
              error,
            )
          }
        }
      }
    }
  }
}

/**
 * Register the host ArkCLI provider for the contributing plugin fiber's lifetime.
 * @param ctx - context carrying image generation and subprocess services.
 * @param config - provider process and image resource limits.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  if (resolved.executable.trim().length === 0) throw new Error('image-generation-arkcli: executable must not be blank')
  assertPositiveInteger('stdoutMaxBytes', resolved.stdoutMaxBytes)
  assertPositiveInteger('stderrMaxBytes', resolved.stderrMaxBytes)
  assertPositiveInteger('graceMs', resolved.graceMs)
  assertPositiveInteger('quiescenceTimeoutMs', resolved.quiescenceTimeoutMs)
  assertPositiveInteger('maxImageBytes', resolved.maxImageBytes)
  assertPositiveInteger('minImagePixels', resolved.minImagePixels)
  assertPositiveInteger('maxImagePixels', resolved.maxImagePixels)
  if (resolved.minImagePixels > resolved.maxImagePixels) {
    throw new Error('image-generation-arkcli: minImagePixels must be no greater than maxImagePixels')
  }
  if (!Number.isFinite(resolved.minAspectRatio) || resolved.minAspectRatio <= 0) {
    throw new Error('image-generation-arkcli: minAspectRatio must be positive and finite')
  }
  if (!Number.isFinite(resolved.maxAspectRatio) || resolved.maxAspectRatio <= 0) {
    throw new Error('image-generation-arkcli: maxAspectRatio must be positive and finite')
  }
  if (resolved.minAspectRatio > resolved.maxAspectRatio) {
    throw new Error('image-generation-arkcli: minAspectRatio must be no greater than maxAspectRatio')
  }
  const provider = new ArkcliImageGenerationProvider(ctx, resolved)
  ctx.effect(function* () {
    yield async () => { await provider.dispose() }
    yield ctx.imageGeneration.registerProvider(provider)
  }, 'image-generation-arkcli lifecycle')
}
