export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function jsonOk(res, payload, status = 200) {
  res.status(status).json({
    ok: true,
    ...payload,
  });
}

export function installCors(app) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Mauworld-Admin-Secret, X-Mauworld-Onboarding-Secret",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
}

export function installErrorHandler(app) {
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        ok: false,
        error: err.message,
        details: err.details ?? null,
      });
      return;
    }

    console.error(err);
    res.status(500).json({
      ok: false,
      error: "Internal Server Error",
    });
  });
}

export function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Invalid ${fieldName}`);
  }
  return value.trim();
}

export function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `Invalid ${fieldName}`);
  }
  return value;
}
