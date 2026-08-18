/**
 * Object storage provider abstraction — currently UNIMPLEMENTED, same
 * "unconfigured stub that fails loudly" pattern as
 * `lib/payments/PaymentProvider.ts`'s `UnconfiguredPaymentProvider`,
 * `lib/notifications/{Email,Sms,Push}Provider.ts`'s `Unconfigured*Provider`,
 * and `lib/ai/AIProvider.ts`'s `UnconfiguredAIProvider`.
 *
 * Master spec §59 "Deployment Architecture" lists "Storage: S3-compatible
 * storage or equivalent" among the external integrations this app must stay
 * provider-agnostic to ("Do not hard-code any specific provider if the
 * architecture can remain provider-agnostic") — this interface is the seam
 * a real object-storage service (e.g. AWS S3, Cloudflare R2, MinIO,
 * DigitalOcean Spaces) plugs into. No concrete implementation exists yet,
 * and none should be faked.
 *
 * This is the last unimplemented provider seam in the codebase — every
 * other forward-reference to `STORAGE_PROVIDER_KEY` (reserved in
 * `.env.example` since Phase 1) has been an honest metadata-only stub
 * pointing back to this file's future existence:
 *   - `prisma/schema.prisma`'s `ExpenseAttachment.fileUrl` (Phase 10)
 *     records where a receipt file *would* live once storage is
 *     configured; no upload ever happens today, so nothing calls
 *     `upload()` here yet — `fileUrl` is entered as plain text metadata.
 *   - `prisma/schema.prisma`'s delivery proof-of-delivery notes (Phase 6,
 *     see the `DeliveryOrder` model's header comment) are a staff-entered
 *     text note + optional recipient name, deliberately not a photo,
 *     because no object storage provider is configured.
 *   - `lib/validation/accounting.ts`'s expense-attachment schema requires
 *     `fileUrl` to already be an `https://` URL rather than accepting a
 *     raw upload, closing a stored-XSS-shaped hole *before* a real upload
 *     flow exists, so a future storage integration doesn't inherit it.
 *
 * Until a real provider is configured (`STORAGE_PROVIDER_KEY` per
 * `.env.example`), nothing in this codebase performs a file upload — every
 * "file" field (`ExpenseAttachment.fileUrl`, driver proof-of-delivery) is
 * either plain text or an externally-hosted URL entered by staff. Wiring in
 * a real provider later is a matter of adding a branch to
 * `getStorageProvider()` below and updating the relevant call sites to
 * actually call `upload()` — it is not a schema or API-contract change.
 */

export interface StorageUploadResult {
  /** Provider-assigned identifier for this stored object. */
  providerReference: string;
  /** Publicly (or signed-URL) resolvable location of the uploaded file. */
  url: string;
}

export interface StorageProvider {
  readonly name: string;

  upload(params: {
    fileName: string;
    contentType: string;
    data: Buffer | Uint8Array;
  }): Promise<StorageUploadResult>;

  /** Deletes a previously uploaded object, identified by its provider reference. */
  delete(providerReference: string): Promise<void>;
}

/**
 * Throws unconditionally — makes "no provider configured" fail loudly
 * instead of silently pretending to succeed. Every call site that might
 * accept a file today (there are none yet — see the file header) must
 * check `provider.name === 'unconfigured'` before ever calling `upload`,
 * the same safety-net role `UnconfiguredPaymentProvider` and
 * `UnconfiguredEmailProvider` play for their respective seams.
 */
export class UnconfiguredStorageProvider implements StorageProvider {
  readonly name = 'unconfigured';

  async upload(): Promise<StorageUploadResult> {
    throw new Error(
      'No storage provider is configured. See docs/architecture.md § Required External ' +
        'Integrations. File fields (e.g. ExpenseAttachment.fileUrl) are entered as plain ' +
        'externally-hosted URLs by staff until a real provider is wired in here.',
    );
  }

  async delete(): Promise<void> {
    throw new Error(
      'No storage provider is configured. See docs/architecture.md § Required External Integrations.',
    );
  }
}

/**
 * Resolves the configured storage provider from environment, following the
 * same provider-agnostic factory shape as `lib/notifications/EmailProvider.ts`'s
 * `getEmailProvider`. Reads `STORAGE_PROVIDER_KEY` (reserved in
 * `.env.example` since Phase 1). No concrete provider is registered in this
 * codebase yet — wiring one in later is a matter of adding a branch here,
 * not changing any call site's contract.
 */
export function getStorageProvider(): StorageProvider {
  const configured = process.env.STORAGE_PROVIDER_KEY;
  if (!configured) return new UnconfiguredStorageProvider();
  // No branch matches yet — every value of STORAGE_PROVIDER_KEY currently
  // falls back to the unconfigured stub until a real provider (e.g. an
  // S3-compatible client) is implemented and registered here.
  return new UnconfiguredStorageProvider();
}
