import { VIBI3D_MATERIAL_PRESETS, VIBI3D_MATERIAL_MAP_SLOTS } from './vibi3dMaterials.js';
import { VIBI3D_SHAPES } from './vibi3dGeometry.js';
import { VIBI3D_BUILTIN_MODULES } from './vibi3dKit.js';
import { buildVibi3DQualityGuide } from './vibi3dQualityGuide.js';

/** Data-only command contract shared by validation, canvas briefs and the in-app agent. */
export interface Vibi3DCommandDefinition {
  type: string;
  syntax: string;
  purpose: string;
  timeoutMs: number;
}

const EDIT_TIMEOUT = 30_000;
const OUTPUT_TIMEOUT = 120_000;
export const VIBI3D_COMMAND_DEFINITIONS: readonly Vibi3DCommandDefinition[] = [
  { type: 'update', syntax: '{type:"update",id,position?:[x,y,z],rotation?:[x,y,z],scale?:[x,y,z],color?:"#rrggbb",shadows?:{cast?,receive?}}', purpose: 'Absolute LOCAL transforms; Euler XYZ degrees; nonzero scale; optional node shadow overrides.', timeoutMs: EDIT_TIMEOUT },
  { type: 'create', syntax: '{type:"create",id?,name,parentId?,recipe,position?,material?}', purpose: 'Create an editable primitive with a stable id.', timeoutMs: EDIT_TIMEOUT },
  { type: 'geometry', syntax: '{type:"geometry",id,recipe}', purpose: 'Replace only the target geometry with an editable recipe. Read and resend unchanged recipe values that must be retained.', timeoutMs: EDIT_TIMEOUT },
  { type: 'wall', syntax: '{type:"wall",id?,name?,parentId?,position?,width?,height?,thickness?,openings?:[{id?,x,y,w,h,reveal?}],material?}', purpose: 'Create an editable wall with real openings, without boolean operations. Origin is center-X/floor-Y/center-Z; opening x/y starts at the lower-left. Reveal is a 45-degree inner taper in meters. Edit later with geometry and recipe.kind="wall".', timeoutMs: EDIT_TIMEOUT },
  { type: 'building', syntax: '{type:"building",id?,name?,parentId?,position?,rotation?,detail?:"draft|architectural",footprint?:{kind:"rect",width,depth}|{kind:"l",width,depth,wingWidth,wingDepth}|{kind:"polygon",points:[[x,z],...]},floors?,groundFloorHeight?,upperFloorHeight?,roof?:"flat|pitched"}', purpose: 'Create or regenerate editable floor plates, columns and corner stair core with stable part IDs. Add a facade on each exterior face; the frame has no hidden walls behind glazing. An existing architecture id updates that recipe; preserve unrelated and locked content.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'facade', syntax: '{type:"facade",id?,name?,parentId?,position?,rotation?,detail?:"draft|architectural",width?,height?,floors?,floorHeights?,bays?,bayWidth?,floorModules?:[["window|solid|balcony|open",...],...],windowDepth?,bandHeight?,eavesDepth?,acDensity?:0..1,side?:"front|back|left|right"}', purpose: 'Assemble recessed glazing, frames, sills, floor bands, eaves, air conditioners and pipes. X is width, +Y up, +Z front; place the facade on the building edge. The ground floor stays open for shops unless floorModules[0] is supplied.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'storefront', syntax: '{type:"storefront",id?,name?,parentId?,position?,rotation?,detail?:"draft|architectural",width?,height?,depth?,style?:"glass|wood|shutter",door?:"left|right|center|none",signBandHeight?,awning?:boolean|{depth?,drop?,height?,colors?:[color,color]},projectingSign?}', purpose: 'Build a shop module with editable door, display, fascia, awning and projecting-sign mount. Add fictional artwork through Vibimage.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'rooftop', syntax: '{type:"rooftop",id?,name?,parentId?,position?,rotation?,detail?:"draft|architectural",width?,depth?,railingHeight?,waterTank?:boolean|{radius?,height?},antenna?}', purpose: 'Build railings, water tank, feed pipe and antenna; place at roof elevation.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'street', syntax: '{type:"street",id?,name?,parentId?,position?,rotation?,detail?:"draft|architectural",length?,roadWidth?,sidewalkWidth?,sidewalks?:"left|right|both",lanes?,laneMarkings?,kerbHeight?,crosswalk?,manholes?,blockColors?:[color,color]}', purpose: 'Build a road, real-scale two-color paving, kerbs, lane markings, crossing and manholes as editable parts.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'prop', syntax: '{type:"prop",id?,name?,parentId?,position?,rotation?,detail?:"draft|architectural",style?:"utilityPole|wire|streetLight|tree|bollard|bench|sandwichBoard|planter",width?,height?,depth?,radius?,path?:[[x,y,z],...],sag?}', purpose: 'Assemble a street prop from native curves and solids. Wires require a path and use sag in meters.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'duplicate', syntax: '{type:"duplicate",id,count?:1..100,offset?:[x,y,z]}', purpose: 'Copy a node and its supported animation.', timeoutMs: EDIT_TIMEOUT },
  { type: 'kitModule', syntax: '{type:"kitModule",id,name?,sourceId?|builtin?,expectedModuleRevision?}', purpose: 'Define a reusable module from one editable subtree or one built-in module. Supply exactly one source. Redefining requires the current module revision and updates every placed instance atomically, preserving locks.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'place', syntax: '{type:"place",id,moduleId,expectedModuleRevision?,parentId?,position?,rotation?,scale?,snap?:false|meters}', purpose: 'Place or update one referenced module using a stable id. Positive scale only; default snap is 0.25 m. Repeated parts share InstancedMesh draw calls.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'array', syntax: '{type:"array",id,moduleId,expectedModuleRevision?,parentId?,counts:[nx,ny,nz],step:[dx,dy,dz],position?,rotation?,scale?,snap?:false|meters}', purpose: 'Place a bounded 3D grid (at most 10,000 total instances). Cells retain stable IDs derived from the array id and integer coordinates. Use returned IDs, never GPU instance indices, to edit or select.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'stats', syntax: '{type:"stats"}', purpose: 'Read object/instance/triangle counts, estimated base draw calls and texture memory, with budget warnings. Send alone; this does not change the revision or undo history.', timeoutMs: EDIT_TIMEOUT },
  { type: 'sign', syntax: '{type:"sign",id?,name?,parentId?,position?,rotation?,kind?:"fascia|projecting|panel|channel|window|banner|rooftop",text?,font?:"sans|serif|display",weight?,color?,outline?:{color,width},background?:color|false,layout?:"horizontal|vertical",size?:[width,height,depth?],lit?,source?}', purpose: 'Create or regenerate editable fictional signage in meters. Bundled OFL Korean outlines drive both baked panels and extruded channel letters. Projecting signs have two faces. Optional artwork source is a pinned Vibimage document or blob.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'decal', syntax: '{type:"decal",id?,name?,target,position?:[x,y,z],normal?:[x,y,z],size?:[width,height,depth?],rotation?:degrees,projection?:"auto|flat|surface",source?}', purpose: 'Attach an alpha sticker to an unlocked mesh using target-local position and normal. Flat mode uses a polygon-offset plane; surface mode projects onto curved geometry. Source is {kind:"vibimage",docId} or {kind:"blob",ref}.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'mascot', syntax: '{type:"mascot",id?,name?,parentId?,position?,rotation?,style?:"round|standee",height?,colors?:{body,accent,face},source?}', purpose: 'Assemble an editable fictional mascot from smooth native primitives, or an alpha standee from a pinned image source. No image-to-3D model or external generation API.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'group', syntax: '{type:"group",ids:[id,...],name}', purpose: 'Group named IDs, preserving world transforms and protected content.', timeoutMs: EDIT_TIMEOUT },
  { type: 'delete', syntax: '{type:"delete",id}', purpose: 'Remove only the requested object; partial rigs are protected.', timeoutMs: EDIT_TIMEOUT },
  { type: 'material', syntax: '{type:"material",id,material:{preset?,params?,seed?,resolution?:128|256|512|1024,wear?:0..1,color?,roughness?,metalness?,opacity?,emissive?,emissiveIntensity?,maps?:{slot:{source}},tileSize?:[metersX,metersY],rotation?,offset?:[u,v],alphaTest?,transparent?,side?:"front|back|double",physical?:{transmission?,ior?,thickness?,clearcoat?},envMapIntensity?,polygonOffset?,polygonOffsetFactor?,polygonOffsetUnits?}}', purpose: 'Apply editable deterministic surface maps, physical glass and real-meter tiling. Source is {kind:"vibimage",docId}, {kind:"blob",ref:"vibi-blob:..."}, or {kind:"procedural",preset,seed?,params?,wear?,resolution?}. Existing source revisions stay pinned; only the user advances them.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'protect', syntax: '{type:"protect",id,locked:boolean}', purpose: 'User protection control. Agents must preserve locked objects and never unlock them.', timeoutMs: EDIT_TIMEOUT },
  { type: 'light', syntax: '{type:"light",id?,name?,kind?:"directional|point|spot|hemisphere|ambient",position?,intensity?,color?}', purpose: 'Create or edit a light; matching studio light gives way to authored lights.', timeoutMs: EDIT_TIMEOUT },
  { type: 'camera', syntax: '{type:"camera",position?:[x,y,z],target?:[x,y,z],lens?:mm|fov?:degrees,aspect?:"9:16|16:9|1:1",eyeHeight?:meters,shot?:{id,name}}', purpose: 'Update the shared view and optionally save a named shot by stable id. Supply lens OR vertical fov; 35 mm film gauge. eyeHeight sets position.y. Omitted values are preserved; choose 1.6 m and 9:16 for portrait street shots. Saved shots are shared by captures, stills and video.', timeoutMs: EDIT_TIMEOUT },
  { type: 'shotRemove', syntax: '{type:"shotRemove",id}', purpose: 'Remove only the named shot with this stable id. Preserve the current view and all other shots.', timeoutMs: EDIT_TIMEOUT },
  { type: 'cameraMotion', syntax: '{type:"cameraMotion",name,keys:[{time,position,target},...]}', purpose: 'Replace the named camera path; increasing times in seconds.', timeoutMs: EDIT_TIMEOUT },
  { type: 'motion', syntax: '{type:"motion",id,name,previousName?,keys:[{time,position?,rotation?,scale?},...]}', purpose: 'Edit a named object animation while preserving other clips.', timeoutMs: EDIT_TIMEOUT },
  { type: 'motionRemove', syntax: '{type:"motionRemove",id,name}', purpose: 'Remove only one named object animation.', timeoutMs: EDIT_TIMEOUT },
  { type: 'lighting', syntax: '{type:"lighting",intensity:0..10}', purpose: 'Compatibility input for the shared scene light level.', timeoutMs: EDIT_TIMEOUT },
  { type: 'look', syntax: '{type:"look",preset?:"studio|daylight|sunset|overcast|night-street",sun?:{azimuth?,elevation?,intensity?,color?},intensity?,exposure?,toneMapping?:"none|aces|agx|neutral",shadows?,ao?,bloom?,fog?,quality?:"auto|draft|final"}', purpose: 'One saved look for all views. Effects accept boolean or bounded settings objects. Omitted values are preserved; choosing another preset starts from its defaults.', timeoutMs: EDIT_TIMEOUT },
  { type: 'select', syntax: '{type:"select",id:string|null}', purpose: 'Select an object; send alone.', timeoutMs: EDIT_TIMEOUT },
  { type: 'undo', syntax: '{type:"undo"}', purpose: 'Undo one live edit; send alone.', timeoutMs: EDIT_TIMEOUT },
  { type: 'redo', syntax: '{type:"redo"}', purpose: 'Redo one live edit; send alone.', timeoutMs: EDIT_TIMEOUT },
  { type: 'checkpoint', syntax: '{type:"checkpoint",stage,label,checks?:[{id,status:"passed|failed|needs-review",note?,evidencePath?}]}', purpose: 'Persist a named work stage and inspection results independently of the source. Applying the work remains the user’s action.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'propose', syntax: '{type:"propose",label}', purpose: 'Submit one final Before/After candidate. Only the user may accept it.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'resume', syntax: '{type:"resume",runId,stage?}', purpose: 'Restore a saved stage of this document after checking its base revision and human edits; send alone.', timeoutMs: OUTPUT_TIMEOUT },
  { type: 'capture', syntax: '{type:"capture",views?:[shotId|shotName|{name?,position,target,lens?|fov?,aspect?}],size?:[width,height],aspect?:"9:16|16:9|1:1",mode?:"lit|clay|wire|ao",quality?:"draft|final"}', purpose: 'Render PNG files under the project and return relative paths; send alone. Explicit size overrides aspect, then named-shot aspect, then 9:16. Omitted quality is final; returned raster reports internal render dimensions/samples separately from PNG size. Draft portrait is 720×1280; final portrait is at least 1080×1920; landscape reverses dimensions and square is 1080×1080. Supply lens OR fov. The JPEG image endpoint remains available.', timeoutMs: OUTPUT_TIMEOUT },
];

export function getVibi3DCommandDefinition(type: unknown): Vibi3DCommandDefinition | undefined {
  return VIBI3D_COMMAND_DEFINITIONS.find((definition) => definition.type === type);
}

export function buildVibi3DCommandReference(): string {
  return [...VIBI3D_COMMAND_DEFINITIONS.map(({ syntax, purpose }) => `- ${syntax} — ${purpose}`),
    `Geometry recipe kinds: ${VIBI3D_SHAPES.join(', ')}. Rounded box: bevelRadius/bevelSegments; capsule: total height and radius; extrude: points, optional holes and bevel {enabled,thickness,size,segments}; sweep: closed profile [x,y,0] and path [x,y,z]; stairs: width/height/depth/steps; wall: width/height/thickness/openings. creaseAngle is in degrees.`,
    `Material presets: ${VIBI3D_MATERIAL_PRESETS.join(', ')}. Map slots: ${VIBI3D_MATERIAL_MAP_SLOTS.join(', ')}.`,
    `Built-in code-generated modules: ${VIBI3D_BUILTIN_MODULES.join(', ')}. Define a module once, then use place or array. For an existing module, read kitModules and supply expectedModuleRevision when redefining it.`,
    'Material params: color/secondaryColor/accentColor (#rrggbb), scale (0.05..20), contrast (0..1), roughness/metalness (0..1), normalStrength (0..3), stripeWidth (0.01..2 m), groutWidth (0.001..0.2 m), fakeInterior (boolean, optional baked room appearance for glass). Use a fixed uint32 seed; capture the result before continuing.',
  ].join('\n');
}

export const VIBI3D_AUTHORING_STAGES = [
  { id: 'blockout', label: 'Blockout: storey masses and real dimensions' },
  { id: 'kit', label: 'Kit: define the required reusable modules' },
  { id: 'assembly', label: 'Assemble facade, corner staircase and rooftop' },
  { id: 'storefronts', label: 'Ground-floor shops and sign frames' },
  { id: 'graphics', label: 'Fictional Korean sign artwork and transparent stickers in Vibimage' },
  { id: 'props', label: 'Props, planters, sandwich boards and an assembled mascot or alpha standee' },
  { id: 'look-shots', label: 'Pavement, daylight look and named shots' },
  { id: 'final', label: 'Final portrait stills: whole building, shop close-up and oblique corner' },
] as const;

export const VIBI3D_REVIEW_CHECKLIST: readonly string[] = [
  '4–5 storeys; ground floor 4–4.5 m, upper floors 3–3.3 m, pavement about 3 m and kerb 0.15 m. Check proportions against the clay image.',
  'White painted concrete/tile facade, band windows, frames, sills, corner stairwell, rooftop railing/tank, air conditioners and pipes.',
  '3–4 shops including timber cladding, display glass, a shutter, a red/white striped awning and entrances.',
  'Only fictional businesses: readable Korean-first fascia/projecting/window signs, varied type and colors; no actual brands, logos or copyrighted mascots.',
  'Transparent stickers and posters on glass/walls; two-tone interlocking pavement, manhole and kerb; an assembled mascot, sandwich boards and planters.',
  'Except glass and emissive surfaces, avoid flat solid colors: real-scale tiling, normal detail, roughness and wear on every surface.',
  'Clear daylight: coherent ground/awning shadows, sky reflections, naturally dark corners, controlled exposure and subtle sign emission.',
  'At least three 9:16 wide-angle shots at 1.6 m eye height: whole building, storefront close-up, oblique corner. Final stills at least 1080×1920.',
  'Check scene statistics and object density (about 200 objects for one building and its pavement); preserve unrelated objects, imported clips and locked content.',
];

export function buildVibi3DWorkflowInstructions(): string {
  return [
    'Use Vibi3D native commands by default. Use the installed Blender kit only for a Blender-authored document or an explicit Blender request.',
    'Do not build a separate editor or modify application source code to fulfill a scene request. No external generation APIs, downloaded assets or executable code in the document.',
    'Write command JSON files and calculate coordinates/arrays in your own shell; send them with the provided Node helper so quoting is identical on Windows, macOS and Linux.',
    'Stages:', ...VIBI3D_AUTHORING_STAGES.map((stage, index) => `${index + 1}. ${stage.id}: ${stage.label}`),
    'At EVERY stage: checkpoint → capture clay and lit → actually open the returned PNG files → check and correct → proceed. Do not claim that an image was inspected unless your image tool opened it.',
    'After opening the captures, record the checklist outcome with another checkpoint for the same stage and checks:[{id,status,note,evidencePath:<returned project-relative PNG path>}]. Use passed only for a check actually inspected; record failed or needs-review honestly. Capturing alone is not a visual review.',
    'Claude: use Read on the PNG. Codex: use the installed image-viewing tool (view_image when provided). If unavailable, explicitly report unverified visual quality.',
    'Read saved stage records before continuing an interrupted run. To continue a previous run, use resume with its runId and optional stage id; never copy another document. Preserve the current revision, human edits, locks, links and their pinned source revisions, blobs, look, shots, recipes and animation.',
    'For every document, including an initially empty source, checkpoint stores intermediate work separately and propose creates a final review candidate. Only the user applies work to the source. Do not accept your own candidate or update existing source-link revisions.',
    'Create sign/sticker artwork in a new Vibimage creation document or use a connected Vibimage source; GET /api/app/creation/guide describes the editable image payload and document API. Apply it with material.maps, sign.source or decal.source using {kind:"vibimage",docId:<source document id>}. The live command uses the same pinned document links as the user texture connection. Only the user advances an existing linked revision. Do not fetch web textures.',
    'Use the bundled sans, serif or display font IDs for Korean lettering. All use shipped OFL font files; no OS font or downloaded artwork is required. Build mascots from native rounded primitives or use mascot {style:"standee",source:<Vibimage source>}; no generated 3D model service.',
    'Save each final camera with camera {position,target,lens:24,aspect:"9:16",shot:{id:<stable shot id>,name:<human label>}}. Use at least whole-building, shop-closeup and corner-oblique shots; set camera eyeHeight:1.6 when choosing a viewpoint. Capture those shot IDs with mode:"lit",quality:"final",size:[1080,1920], open every returned PNG and report its path. The editor shot list can save stills and create a video using the same saved views; cameraMotion provides moving shots with the same look.',
    'On 409 stale-base or revision-conflict, preserve newer human edits and re-read the document. A candidate-limit error requires the user to review waiting candidates; do not repeat propose. Preserve existing vibi-blob: references.',
    'Inspection checklist:', ...VIBI3D_REVIEW_CHECKLIST.map((item) => `- ${item}`),
    buildVibi3DQualityGuide(),
  ].join('\n');
}
