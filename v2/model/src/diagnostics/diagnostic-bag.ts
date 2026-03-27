// ---------------------------------------------------------------------------
// DiagnosticBag — collects diagnostics during graph construction and
// extraction. Provides query methods for filtering by code, severity, or scope.
// ---------------------------------------------------------------------------

import type { EntityRef } from "../identity/types.js";
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticScope,
  DiagnosticSeverity,
} from "./types.js";

export class DiagnosticBag {
  private readonly _items: Diagnostic[] = [];

  add(
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    scope: DiagnosticScope,
    message: string,
    payload?: Record<string, unknown>,
  ): void {
    this._items.push({ code, severity, scope, message, payload });
  }

  error(code: DiagnosticCode, scope: DiagnosticScope, message: string, payload?: Record<string, unknown>): void {
    this.add(code, "error", scope, message, payload);
  }

  warning(code: DiagnosticCode, scope: DiagnosticScope, message: string, payload?: Record<string, unknown>): void {
    this.add(code, "warning", scope, message, payload);
  }

  info(code: DiagnosticCode, scope: DiagnosticScope, message: string, payload?: Record<string, unknown>): void {
    this.add(code, "info", scope, message, payload);
  }

  all(): readonly Diagnostic[] {
    return this._items;
  }

  byCode(code: DiagnosticCode): Diagnostic[] {
    return this._items.filter((d) => d.code === code);
  }

  bySeverity(severity: DiagnosticSeverity): Diagnostic[] {
    return this._items.filter((d) => d.severity === severity);
  }

  forEntity(entityRef: EntityRef): Diagnostic[] {
    return this._items.filter(
      (d) => d.scope.kind === "entity" && d.scope.entityRef.id === entityRef.id,
    );
  }

  forPart(partUri: string): Diagnostic[] {
    return this._items.filter(
      (d) => d.scope.kind === "part" && d.scope.partUri === partUri,
    );
  }

  hasErrors(): boolean {
    return this._items.some((d) => d.severity === "error");
  }

  hasWarnings(): boolean {
    return this._items.some((d) => d.severity === "warning");
  }

  get count(): number {
    return this._items.length;
  }

  clear(): void {
    this._items.length = 0;
  }
}
