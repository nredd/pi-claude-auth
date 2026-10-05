import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { buildUserAgent } from "./signing.ts"
import { injectBillingHeader } from "./transforms.ts"

const PROVIDER_ID = "anthropic"

/**
 * pi-claude-auth extension.
 *
 * Auth is pi's own: `/login`, `/logout` and token refresh use the native
 * Anthropic provider and pi's auth store. This extension never touches
 * credentials. It only shapes outgoing requests:
 *
 * - Overrides the `anthropic` provider's user-agent to the Claude Code form
 *   (`claude-cli/<version> (external, <entrypoint>)`).
 * - Injects the `x-anthropic-billing-header` system entry into Anthropic
 *   payloads. This is formatting only; which plan a request bills against is
 *   decided by Anthropic.
 */
const extension = async (pi: ExtensionAPI): Promise<void> => {
    pi.registerProvider(PROVIDER_ID, {
        headers: { "user-agent": buildUserAgent() },
    })

    pi.on("before_provider_request", (event, ctx) => {
        // Pi exposes the selected virtual model here, not its resolved provider.
        // Direct enterprise providers are excluded; routed requests additionally
        // need the native OAuth identity block checked by injectBillingHeader.
        if (
            ctx.model?.provider !== PROVIDER_ID &&
            ctx.model?.api !== "pi-virtual"
        )
            return undefined
        try {
            return injectBillingHeader(event.payload)
        } catch {
            return undefined
        }
    })
}

export const ClaudeAuthExtension = extension
export default extension
