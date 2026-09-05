import type {
  QueueAttemptIdRef,
  QueueWorkIdRef,
} from '@changanhua/dsh-delivery-protocol'
import type { CodeChangeRunRequest } from '../src/index.ts'

type Expect<Value extends true> = Value

type QueueWorkIdentityIsRequired = Expect<
  CodeChangeRunRequest['queueWorkId'] extends QueueWorkIdRef
    ? QueueWorkIdRef extends CodeChangeRunRequest['queueWorkId']
      ? true
      : false
    : false
>
type QueueAttemptIdentityIsRequired = Expect<
  CodeChangeRunRequest['queueAttemptId'] extends QueueAttemptIdRef
    ? QueueAttemptIdRef extends CodeChangeRunRequest['queueAttemptId']
      ? true
      : false
    : false
>
type MissingWorkIdentityIsRejected = Expect<
  Omit<CodeChangeRunRequest, 'queueWorkId'> extends CodeChangeRunRequest
    ? false
    : true
>
type MissingAttemptIdentityIsRejected = Expect<
  Omit<CodeChangeRunRequest, 'queueAttemptId'> extends CodeChangeRunRequest
    ? false
    : true
>

void (null as unknown as QueueWorkIdentityIsRequired)
void (null as unknown as QueueAttemptIdentityIsRequired)
void (null as unknown as MissingWorkIdentityIsRejected)
void (null as unknown as MissingAttemptIdentityIsRejected)
