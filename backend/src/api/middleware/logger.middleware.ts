import { Request, Response, NextFunction } from 'express';

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  // Express changes req.path while traversing mounted routers.
  const path = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${path} ${res.statusCode} (${duration}ms)`);
  });
  next();
}
