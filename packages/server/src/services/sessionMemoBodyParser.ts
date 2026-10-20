import express, { type RequestHandler } from 'express';

// A session sends its full open + closed memo list. The default 100 KB parser
// rejects even a normal set of full-length Korean notes; scope the larger limit.
export const sessionMemoBodyParser: RequestHandler = express.json({ limit: '16mb' });
