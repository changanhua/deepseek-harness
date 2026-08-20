# Agent Note: Java developer orientation path

Status: implemented

English | [中文](2026-08-20-java-developer-orientation-path.zh.md)

## Problem

The numbered Cordis tutorial teaches the plugin framework through runnable experiments, while the architecture and subsystem references assume the reader can already navigate Agent, Session, event, and capability terminology. Java developers can understand the project faster with a short runtime map, but turning the architecture reference into a second tutorial would duplicate facts and weaken document ownership.

## Decision

The Java-oriented runtime map lives in [the Java developer path](../../../../docs/cordis-tutorial/java-developer-path.md). The page is a non-runnable orientation guide linked from the Cordis tutorial index before the numbered experiments. It uses Java approximations only as entry points, states the differences that matter, follows one request from Profile to SessionEvent, and links each detailed contract to its owning architecture page, subsystem page, or package README.

The English and Simplified Chinese pages remain a complete translation pair, and the website manifest publishes both through the existing Cordis framework tutorial section.

## Alternatives considered

**Turn `docs/architecture.md` into a tutorial.** This would mix the ordered architecture map with prerequisite-based teaching and duplicate the existing runnable Cordis chapters, so the architecture page remains a reference.

**Add a runnable chapter 08.** The Java path has no new executable exercise; presenting it as a numbered experiment would misstate its purpose and make the chapter index less predictable, so it remains an orientation page beside the runnable chapters.

**Publish only a Chinese page or leave the page out of the site.** Current documentation requires bilingual pairs, and the page is intended as an entry point for external contributors, so it has an English counterpart and an explicit site manifest entry.

## Consequences

The tutorial now has two entry routes: Java developers can read the runtime map first, while readers who prefer code can start with the first plugin. The orientation page must keep its Java analogies qualified and must link rather than restate package contracts. Adding another contributor audience now requires maintaining the source pair, its consistency record, the tutorial index, and the website manifest.

## Verification

The named translation pairs pass `verify-translation-pairing`, all repository Markdown links pass `verify-md-links`, the published fragment check passes, and the VitePress documentation build completes. Full `doc-sync` and `lint` remain affected by other stale catalogs, prose-budget, JSDoc, type-equivalence, formatting, and UI/task-queue violations in the current dirty checkout.
