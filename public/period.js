/**
 * Relativní měsíční období pro rychlé nastavení „Transakce od–do".
 * Bez závislostí, čistá funkce — testovatelná bez DOM.
 */

/** RRRR-MM-DD z lokálního data (toISOString by posunul o časové pásmo). */
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Celé měsíce vůči `base`:
 *   offset  0 = měsíc base, −1 = předchozí, −2 = předminulý…
 *   count      = kolik měsíců zpět včetně zvoleného (1 = jen ten, 2 = i předchozí).
 * new Date(rok, index, …) si přetečení indexu (i přes rok) srovná sám.
 * Vrací { from, to } jako RRRR-MM-DD (první a poslední den období).
 */
export function monthRange(base, offset = 0, count = 1) {
  const off = Math.trunc(Number(offset) || 0);
  const cnt = Math.max(1, Math.trunc(Number(count) || 1));
  const endIdx = base.getMonth() + off;        // měsíc, kterým období končí
  const startIdx = endIdx - (cnt - 1);         // o (count−1) měsíců dřív
  const from = new Date(base.getFullYear(), startIdx, 1);
  const to = new Date(base.getFullYear(), endIdx + 1, 0); // den 0 = poslední den předchozího měsíce
  return { from: iso(from), to: iso(to) };
}
