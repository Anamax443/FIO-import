/** Společný datový model řádku (SPEC.md §5). */

export type Source = 'fio' | 'revolut' | 'pravidelna';

export type Status = 'NEW' | 'ALREADY_CLAIMED' | 'DUPLICATE_IN_BATCH';

export interface LineItem {
  /** Stabilní ID v rámci jedné dávky (pro UI a /api/generate). */
  id: string;
  source: Source;
  /** ID transakce z exportu — reálné Fio/Revolut exporty ho nenesou. */
  txn_id?: string;
  /** Náhradní klíč = datum_txn + částka (obchodník se mezi zdroji liší). */
  fingerprint: string;
  status: Status;
  /** Povinná platba (stočné, plyn, elektrika) — v editaci chráněná. */
  mandatory: boolean;
  /** Jde do XML? */
  include: boolean;
  /** Částka v CZK. */
  amount: number;
  /** Původní měna, jen informativně (EUR/PLN…). */
  currency_orig?: string;
  /** Text zprávy = comment. */
  message: string;
  /** Datum transakce RRRR-MM-DD (jde jen do textu zprávy). */
  date_txn?: string;
  kategorie?: string;
  merchant?: string;
  /** Upozornění pro uživatele (dedup, vícemenovost, AI). */
  note?: string;
}

/** Záznam už uplatněného nákladu (historie pro dedup). */
export interface LedgerEntry {
  fingerprint: string;
  date_txn: string;
  amount: number;
  merchant?: string;
  source: string;
}
