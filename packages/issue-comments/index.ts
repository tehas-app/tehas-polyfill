// The issue-comments pi extension (spec S4): it reads the host's comments blob once per session
// and injects it as one custom message at `before_agent_start`. It never throws and never writes
// anything but its two stderr lines.

import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectComments, imageDirs, nothingToRead } from "./read.ts";
import { renderComments } from "./render.ts";
import type { CollectOutcome } from "./types.ts";

const CUSTOM_TYPE = "issue-comments";
const PREFIX = "issue-comments polyfill: ";

/** A reason for a failure that never reached the reader's own reason strings. */

/** A reason for a failure that never reached the reader's own reason strings. */
function failureReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "internal error";
}

/**
 * The reason inside `no comments (...)`. This extension is the only writer of the line, so the
 * ambiguous case has to name the directories itself (S3 rule 5).
 */
function outcomeReason(outcome: Extract<CollectOutcome, { ok: false }>): string {
  if (outcome.reason === "ambiguous" && "dirs" in outcome && outcome.dirs.length > 0) {
    return `ambiguous: ${outcome.dirs.join(", ")}`;
  }
  return outcome.reason;
}

export function issueCommentsExtension(pi: ExtensionAPI): void {
  // S3 rule 6: a failure leaves the session untouched, so only a read pair is consumed.
  let attempted = false;

  pi.on("session_start", () => {
    attempted = false;
  });

  pi.on("before_agent_start", (event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined => {
    if (event.messageType !== "user" || attempted) return undefined;

    // Nothing configured: the session is not a polyfilled one, so it says nothing and keeps its
    // one attempt for the session. The latch is set only once there is something to read.
    if (imageDirs(process.env).length === 0) return undefined;

    // S4: the latch is set before the blob is read, so a read that fails writes its one line for
    // the session instead of one for every turn.
    attempted = true;

    try {
      const outcome = collectComments(process.env);
      if (!outcome.ok) {
        // S4: nothing to read writes nothing; a manifest the host wrote but could not parse, and
        // any `comments` entry whose blob cannot be used, get this one line. The reader ranks a
        // directory that named a comments blob above one that had nothing to read, so a corrupt
        // pair is never silenced by the images-only directory next to it.
        if (!nothingToRead(outcome.reason)) console.error(`${PREFIX}no comments (${outcomeReason(outcome)})`);
        return undefined;
      }

      const rendered = renderComments(outcome.blob);
      // S4: the audit line is written whenever a valid blob was read, even with nothing to inject.
      console.error(`${PREFIX}${rendered.count} comments, ${rendered.bytes} bytes, ${rendered.dropped} dropped`);

      // Nothing was rendered: the header alone is not worth a message.
      if (rendered.count === 0) return undefined;

      return {
        message: {
          customType: CUSTOM_TYPE,
          content: rendered.text,
          display: true,
        },
      };
    } catch (error) {
      console.error(`${PREFIX}no comments (${failureReason(error)})`);
      return undefined;
    }
  });
}

export default issueCommentsExtension;
