import * as THREE from 'three';
import type { CreationValue } from '@vibisual/shared';
import type { AppTaskDocumentBuilder } from '../../apps/registry.js';
import { createCreationDoc } from '../Creation/creationApi.js';
import { copyTaskSource } from '../Creation/copyTaskSource.js';
import { disposeModel, loadWorkspaceModel } from './modelIO.js';
import { readModelDocument, serializeModelSource } from './modelSource.js';

export const prepareModelTaskDocument: AppTaskDocumentBuilder = async (args) => {
  if (args.mode === 'copy' && args.source.ref) {
    const source = await readModelDocument(args.projectId, args.source.ref);
    return { ref: (await copyTaskSource(args.projectId, source, args.title, args.requestId)).id };
  }
  const loaded = args.mode === 'copy' && args.source.file
    ? await loadWorkspaceModel(args.projectId, args.source.file)
    : { object: new THREE.Group(), clips: [] };
  try {
    loaded.object.name ||= args.title;
    const doc = await createCreationDoc(args.projectId, { appId: 'vibi3d', title: args.title, requestId: args.requestId,
      payload: serializeModelSource(loaded.object, loaded.clips) as unknown as CreationValue });
    return { ref: doc.id };
  } finally { disposeModel(loaded.object); }
};
