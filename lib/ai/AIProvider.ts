/**
 * AI provider abstraction — currently UNIMPLEMENTED, by design.
 *
 * Master spec §57 lists "AI: Configurable AI provider" among the external
 * integrations this app must stay agnostic to ("Do not hard-code any
 * specific provider if the architecture can remain provider-agnostic"),
 * and §39 ("AI SAFETY RULE") is stricter still: the AI layer is an
 * analytical assistant, never the source of financial truth, and it "must
 * read verified data through controlled server-side tools/services" —
 * never given unrestricted database access.
 *
 * This interface is deliberately narrow given that rule: an `AIProvider`
 * may only turn ALREADY-COMPUTED, ALREADY-VERIFIED insight data (see
 * services/ai/InsightService.ts) into better-written prose. It is never
 * handed a database connection, a Prisma client, or a raw prompt the model
 * could use to invent its own figures — only the structured `Insight[]`
 * InsightService already produced from real service calls. A provider
 * implementation is free to reorder, summarize, or rephrase; it must never
 * be asked to supply a number that didn't already appear in its input.
 *
 * No concrete implementation exists yet, and none should be faked — same
 * "unconfigured stub that fails loudly" pattern as
 * lib/payments/PaymentProvider.ts's UnconfiguredPaymentProvider. Until a
 * real provider is configured (see docs/architecture.md § Required
 * External Integrations), InsightService's deterministic, template-based
 * narration (built entirely from real computed figures, matching the
 * master spec's own worked example in §38) is the complete feature —
 * narration from a configured AIProvider is an optional prose upgrade on
 * top of it, never a prerequisite for it.
 */

export interface AiInsightForNarration {
  category: string;
  severity: string;
  title: string;
  summary: string;
  recommendations: string[];
  /** Underlying figures this insight is built from — the only numbers a provider may reference. */
  metrics: Array<{ label: string; value: string; previousValue?: string; percentChange?: number | null }>;
}

export interface AiNarrationRequest {
  /** Already-computed, already-verified insights — the only data a provider may narrate. */
  insights: AiInsightForNarration[];
  context: {
    organizationName: string;
    currency: string;
    periodLabel: string;
  };
}

export interface AiNarrationResult {
  /** Provider-generated prose narrative summarizing `insights`. Must not introduce any figure not already present in the request. */
  narrative: string;
}

export interface AIProvider {
  readonly name: string;

  /**
   * Turns already-computed insights into a short prose narrative (e.g. a
   * "Good morning — here's what changed" summary). Implementations must
   * not call out to any data source of their own; the `insights` array is
   * the complete, closed set of facts they may describe.
   */
  narrate(request: AiNarrationRequest): Promise<AiNarrationResult>;
}

/**
 * Throws unconditionally — a stand-in that makes "no AI provider
 * configured" fail loudly instead of silently pretending to succeed.
 * InsightService catches this and falls back to its own deterministic
 * narration rather than letting it bubble up as a request failure — see
 * that file's generateInsights for the fallback.
 */
export class UnconfiguredAIProvider implements AIProvider {
  readonly name = 'unconfigured';

  async narrate(): Promise<AiNarrationResult> {
    throw new Error(
      'No AI provider is configured. See docs/architecture.md § Required External Integrations. ' +
        'InsightService.generateInsights falls back to deterministic, template-based narration ' +
        'until one is configured — this error should only surface if something calls ' +
        'getAIProvider().narrate() directly without that fallback.',
    );
  }
}

/**
 * Resolves the configured AI provider from environment, following the same
 * "provider-agnostic factory" shape as a real payment/notification provider
 * factory would use. No concrete provider is registered in this codebase
 * yet (see file header) — AI_PROVIDER is read defensively so wiring one in
 * later is a matter of adding a branch here, not changing any call site.
 */
export function getAIProvider(): AIProvider {
  const configured = process.env.AI_PROVIDER;
  if (!configured) return new UnconfiguredAIProvider();
  // No branch matches yet — every value of AI_PROVIDER currently falls
  // back to the unconfigured stub until a real provider is implemented and
  // registered here.
  return new UnconfiguredAIProvider();
}
