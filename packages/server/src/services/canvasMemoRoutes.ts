import type { Express } from 'express';
import { graphManager } from './projectGraphManager.js';
import { subAgentManager } from './subAgentManager.js';
import { CanvasMemoService } from './canvasMemos.js';
import { logger } from '../logger.js';

export function registerCanvasMemoRoutes(app: Express, changed: () => void): void {
  const service = new CanvasMemoService({
    projectOf: (id) => graphManager.getAgentProjectName(id),
    available: (id, subId) => graphManager.hasLiveAgentId(id)
      && (!subId || subAgentManager.getSub(subId)?.parentAgentId === id || subAgentManager.getArchived(id).some((s) => s.id === subId)),
    read: (id, subId) => subId ? (subAgentManager.getSub(subId)
      ?? subAgentManager.getArchived(id).find((s) => s.id === subId))?.memos ?? [] : graphManager.getAgentMemos(id),
    write: (id, subId, memos) => {
      if (subId) {
        subAgentManager.restoreFromArchive(subId, id);
        subAgentManager.setSessionMemos(subId, memos);
      } else graphManager.setAgentMemos(id, memos);
    },
    readCanvas: (project) => graphManager.getCanvasMemos(project),
    writeCanvas: (project, memos) => graphManager.setCanvasMemos(project, memos),
    markDeleted: (project, id) => graphManager.markCanvasMemoDeleted(project, id),
  });
  app.post('/api/canvas-memos/:action', (req, res) => {
    try {
      const b = req.body as Record<string, unknown> | undefined;
      if (!b || typeof b !== 'object') { res.status(400).json({ ok: false }); return; }
      if (req.params['action'] === 'move') {
        if (typeof b['agentId'] !== 'string' || typeof b['memoId'] !== 'string'
          || (b['subAgentId'] !== null && typeof b['subAgentId'] !== 'string')
          || typeof b['x'] !== 'number' || typeof b['y'] !== 'number' || !Array.isArray(b['memos'])) {
          res.status(400).json({ ok: false }); return;
        }
        const memos = service.move({ agentId: b['agentId'], subAgentId: b['subAgentId'], memoId: b['memoId'],
          wholeCard: b['wholeCard'] === true, memos: b['memos'], x: b['x'], y: b['y'],
          folderId: typeof b['folderId'] === 'string' ? b['folderId'] : null });
        if (!memos) { res.status(409).json({ ok: false }); return; }
        changed(); res.json({ ok: true, memos }); return;
      }
      const project = typeof b['project'] === 'string' ? b['project'] : '';
      if (!project || !graphManager.getProjectByName(project)) { res.status(404).json({ ok: false }); return; }
      if (req.params['action'] === 'save' && Array.isArray(b['memos'])) {
        const memos = service.save(project, b['memos']);
        changed(); res.json({ ok: true, memos }); return;
      }
      const id = typeof b['memoId'] === 'string' ? b['memoId'] : '';
      if (req.params['action'] === 'home') {
        res.json({ ok: true, returnAvailable: service.canReturn(project, id) }); return;
      }
      const ok = req.params['action'] === 'return' ? service.returnHome(project, id)
        : req.params['action'] === 'delete' && service.delete(project, id);
      if (ok) changed();
      res.status(ok ? 200 : 409).json({ ok, memos: graphManager.getCanvasMemos(project) });
    } catch (err) {
      logger.error('canvas memo request failed', err);
      res.status(500).json({ ok: false });
    }
  });
}
