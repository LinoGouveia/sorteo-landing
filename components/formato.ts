export const dinero = (n: number, decimales = 0) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;

/** "2026-09-14" → "14/09" sin pasar por Date (evita el corrimiento de zona horaria). */
export const fecha = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

export const nombreMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleString("es-VE", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
