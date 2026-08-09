export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function text(value, field, options = {}) {
  const normalized = String(value ?? "").trim();
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? 200;
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new HttpError(400, `${field} precisa ter entre ${minimum} e ${maximum} caracteres.`);
  }
  return normalized;
}

export function positiveInteger(value, field = "Valor") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} precisa ser um número inteiro positivo.`);
  }
  return parsed;
}

export function quantity(value, minimum, maximum) {
  const parsed = positiveInteger(value, "Quantidade");
  if (parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `A quantidade deve ficar entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

export function httpUrl(value) {
  const normalized = text(value, "Link", { minimum: 8, maximum: 2048 });
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpError(400, "Informe um link válido.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpError(400, "O link precisa começar com http:// ou https://.");
  }
  return parsed.toString();
}

export function uuid(value, field = "Identificador") {
  const normalized = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new HttpError(400, `${field} inválido.`);
  }
  return normalized;
}

export function booleanValue(value, field = "Valor") {
  if (typeof value !== "boolean") throw new HttpError(400, `${field} precisa ser verdadeiro ou falso.`);
  return value;
}
