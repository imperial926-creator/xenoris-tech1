import 'server-only';
import { prisma } from '@/lib/db/prisma';

/**
 * Master Data Analytics spec's export requirement (§ Data Security —
 * "exports must be permission-controlled and audited"). CSV and JSON are
 * REAL, working exports. Excel (.xlsx) and PDF are NOT implemented — see
 * the Phase 18 header comment in schema.prisma for why this is a
 * documented gap rather than a fake binary. `logExport` is always called
 * BEFORE the data is returned to the caller, so an export the client
 * aborts mid-stream is still on record.
 */
export class ExportService {
  static toCsv(rows: Array<Record<string, unknown>>): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (value: unknown) => {
      const s = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => escape(row[h])).join(','));
    }
    return lines.join('\n');
  }

  static async logExport(params: {
    platformAdminId: string;
    reportType: string;
    format: string;
    filters?: Record<string, unknown>;
    rowCount?: number;
  }) {
    return prisma.platformExportLog.create({
      data: {
        platformAdminId: params.platformAdminId,
        reportType: params.reportType,
        format: params.format,
        filters: params.filters,
        rowCount: params.rowCount,
      },
    });
  }

  static async export(params: {
    platformAdminId: string;
    reportType: string;
    format: 'csv' | 'json';
    rows: Array<Record<string, unknown>>;
    filters?: Record<string, unknown>;
  }): Promise<{ content: string; contentType: string }> {
    if (params.format !== 'csv' && params.format !== 'json') {
      throw new Error(`Export format "${params.format}" is not implemented. Only csv and json are supported.`);
    }

    await this.logExport({
      platformAdminId: params.platformAdminId,
      reportType: params.reportType,
      format: params.format,
      filters: params.filters,
      rowCount: params.rows.length,
    });

    if (params.format === 'json') {
      return { content: JSON.stringify(params.rows, null, 2), contentType: 'application/json' };
    }
    return { content: this.toCsv(params.rows), contentType: 'text/csv' };
  }
}
