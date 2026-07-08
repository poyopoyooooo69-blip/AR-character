import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const ui = {
  start: document.querySelector("#start-button"),
  retry: document.querySelector("#retry-button"),
  sound: document.querySelector("#sound-button"),
  welcome: document.querySelector("#welcome-card"),
  guide: document.querySelector("#placement-guide"),
  guideText: document.querySelector("#guide-text"),
  interaction: document.querySelector("#interaction-guide"),
  bubble: document.querySelector("#speech-bubble"),
  error: document.querySelector("#error-card"),
  errorMessage: document.querySelector("#error-message"),
  flash: document.querySelector("#flash"),
  video: document.querySelector("#camera-feed"),
  stage: document.querySelector("#stage"),
};

const DEFAULT_STAGE_YAW = Math.PI / 4;

const state = {
  mode: "preview",
  placed: false,
  action: null,
  actionStartedAt: 0,
  actionIndex: 0,
  sound: true,
  hitTestSource: null,
  hitTestRequested: false,
  targetQrData: null,
  userYaw: DEFAULT_STAGE_YAW,
};

let tapMotion = null;
const qrTracker = {
  canvas: document.createElement("canvas"),
  context: null,
  lastScanAt: 0,
  lastSeenAt: 0,
};
qrTracker.context = qrTracker.canvas.getContext("2d", { willReadFrequently: true });

const gesture = {
  pointerId: null,
  startX: 0,
  startY: 0,
  startYaw: 0,
  moved: false,
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 40);
camera.position.set(0, 0.15, 4.2);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
ui.stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x657097, 2.4));
const keyLight = new THREE.DirectionalLight(0xfff2ce, 3);
keyLight.position.set(2, 4, 3);
keyLight.castShadow = true;
scene.add(keyLight);

let character = createCharacter();
character.root.visible = true;
const anchor = new THREE.Group();
anchor.position.set(0, -0.96, 0);
scene.add(anchor);
anchor.add(character.root);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(0.74, 64),
  new THREE.MeshBasicMaterial({
    map: createShadowTexture(),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.004;
ground.renderOrder = -1;
anchor.add(ground);

loadVetnumModel();
loadTapMotion();

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.09, 0.12, 36).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd33d }),
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let audioContext;

function createShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 10, 128, 128, 118);
  gradient.addColorStop(0, "rgba(16, 12, 8, 0.72)");
  gradient.addColorStop(0.42, "rgba(16, 12, 8, 0.46)");
  gradient.addColorStop(0.76, "rgba(16, 12, 8, 0.16)");
  gradient.addColorStop(1, "rgba(16, 12, 8, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function loadTapMotion() {
  try {
    const source = await new FBXLoader().loadAsync("./assets/Idle.fbx");
    const clip = source.animations.find((animation) => animation.duration > 0 && animation.tracks.length > 0);
    if (!clip) throw new Error("No usable animation clip was found in Idle.fbx.");

    const boneNames = [
      "mixamorigHips", "mixamorigSpine", "mixamorigSpine1", "mixamorigSpine2", "mixamorigNeck", "mixamorigHead",
      "mixamorigLeftArm", "mixamorigLeftForeArm", "mixamorigLeftHand",
      "mixamorigRightArm", "mixamorigRightForeArm", "mixamorigRightHand",
      "mixamorigLeftUpLeg", "mixamorigLeftLeg", "mixamorigRightUpLeg", "mixamorigRightLeg",
    ];
    const bones = {};
    const rest = {};
    boneNames.forEach((name) => {
      const bone = source.getObjectByName(name);
      if (!bone) return;
      bones[name] = bone;
      rest[name] = { quaternion: bone.quaternion.clone(), position: bone.position.clone() };
    });

    const mixer = new THREE.AnimationMixer(source);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    tapMotion = { source, clip, mixer, action, bones, rest };
  } catch (error) {
    console.warn("Tap animation could not be loaded.", error);
  }
}

async function loadVetnumModel() {
  try {
    const gltf = await new GLTFLoader().loadAsync("./assets/vetnum.glb");
    const replacement = gltf.animations.length
      ? prepareRiggedCharacter(gltf)
      : prepareVetnumCharacter(gltf.scene);
    const wasVisible = character.root.visible;
    anchor.remove(character.root);
    character = replacement;
    character.root.visible = wasVisible;
    anchor.add(character.root);
    resetPose();
  } catch (error) {
    console.warn("Custom GLB model could not be loaded; using the built-in character.", error);
  }
}

function createHandTools(handBone) {
  if (!handBone) return {};
  const metal = new THREE.MeshStandardMaterial({ color: 0xcbd1d8, roughness: 0.32, metalness: 0.68 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.38, metalness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9b552d, roughness: 0.74 });
  const tools = {};

  const makeTool = (name) => {
    const group = new THREE.Group();
    group.name = `tool-${name}`;
    group.position.set(0.05, -0.48, 0.1);
    group.rotation.set(0.25, 0, -0.45);
    group.visible = false;
    handBone.add(group);
    tools[name] = group;
    return group;
  };

  const addHandle = (group, length = 0.62) => {
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, length, 5, 10), wood);
    handle.castShadow = true;
    group.add(handle);
    return handle;
  };

  const spatula = makeTool("spatula");
  addHandle(spatula, 0.58);
  const spatulaHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.055), darkMetal);
  spatulaHead.position.y = 0.49;
  spatulaHead.castShadow = true;
  spatula.add(spatulaHead);

  const whisk = makeTool("whisk");
  addHandle(whisk, 0.48);
  for (let index = -1; index <= 1; index += 1) {
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.13 + Math.abs(index) * 0.025, 0.016, 6, 16), metal);
    wire.position.y = 0.43;
    wire.rotation.x = Math.PI / 2;
    wire.rotation.y = index * 0.45;
    whisk.add(wire);
  }

  const ladle = makeTool("ladle");
  addHandle(ladle, 0.64);
  const ladleCup = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), metal);
  ladleCup.position.y = 0.51;
  ladleCup.scale.set(1, 0.35, 1);
  ladle.add(ladleCup);

  const knife = makeTool("knife");
  const knifeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.12), wood);
  knifeHandle.position.y = -0.17;
  knife.add(knifeHandle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.34), metal);
  blade.position.y = 0.3;
  blade.castShadow = true;
  knife.add(blade);

  const shaker = makeTool("shaker");
  const shakerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.38, 16), metal);
  const shakerTop = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.09, 16), darkMetal);
  shakerTop.position.y = 0.23;
  shaker.add(shakerBody, shakerTop);

  return tools;
}

function hideRiggedTools(riggedCharacter) {
  Object.values(riggedCharacter.tools || {}).forEach((tool) => {
    tool.visible = false;
  });
}

function chooseRiggedStationTool(riggedCharacter) {
  hideRiggedTools(riggedCharacter);
  const station = riggedCharacter.motion.stations[riggedCharacter.motion.waypointIndex];
  if (!station.tools.length || Math.random() > station.toolChance) return;
  const name = station.tools[Math.floor(Math.random() * station.tools.length)];
  if (riggedCharacter.tools[name]) riggedCharacter.tools[name].visible = true;
}

function createRouteGuide(waypoints) {
  const group = new THREE.Group();
  group.name = "cooking-route-guide";
  const routeMaterial = new THREE.MeshStandardMaterial({
    color: 0x45bff2,
    emissive: 0x12658d,
    emissiveIntensity: 0.65,
    roughness: 0.52,
  });
  const pointMaterial = new THREE.MeshStandardMaterial({
    color: 0xffc832,
    emissive: 0x8f5600,
    emissiveIntensity: 0.7,
    roughness: 0.45,
  });
  const routeY = 0.76;

  waypoints.forEach((point, index) => {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.09, 24), pointMaterial);
    pad.position.set(point.x, routeY, point.z);
    pad.receiveShadow = true;
    group.add(pad);

    const next = waypoints[(index + 1) % waypoints.length];
    const dx = next.x - point.x;
    const dz = next.z - point.z;
    const length = Math.hypot(dx, dz);
    const segment = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, length), routeMaterial);
    segment.position.set((point.x + next.x) / 2, routeY - 0.01, (point.z + next.z) / 2);
    segment.rotation.y = Math.atan2(dx, dz);
    segment.receiveShadow = true;
    group.add(segment);
  });

  return group;
}

function createCookingField(waypoints) {
  const group = new THREE.Group();
  group.name = "clean-cooking-field";

  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: 0x6e8297, roughness: 0.86 }),
    floorEdge: new THREE.MeshStandardMaterial({ color: 0x344b63, roughness: 0.72 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x8eb6ce, roughness: 0.58, metalness: 0.18 }),
    beltEdge: new THREE.MeshStandardMaterial({ color: 0x3f6f91, roughness: 0.52, metalness: 0.28 }),
    counter: new THREE.MeshStandardMaterial({ color: 0xb7d0df, roughness: 0.62 }),
    counterTop: new THREE.MeshStandardMaterial({ color: 0xd9e7ee, roughness: 0.38, metalness: 0.16 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffc436, roughness: 0.48 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xbfc8cc, roughness: 0.32, metalness: 0.72 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x4d5a63, roughness: 0.38, metalness: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xb8743c, roughness: 0.74 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd94b45, roughness: 0.66 }),
    green: new THREE.MeshStandardMaterial({ color: 0x64ad55, roughness: 0.7 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xf2993a, roughness: 0.68 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xf1dfb5, roughness: 0.7 }),
  };

  const addMesh = (geometry, material, position, name, rotation = null) => {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.position.set(...position);
    if (rotation) object.rotation.set(...rotation);
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.characterPart = false;
    group.add(object);
    return object;
  };

  addMesh(new THREE.BoxGeometry(13.8, 0.28, 13.4), materials.floorEdge, [7.35, 0.38, 0.05], "field-base");
  addMesh(new THREE.BoxGeometry(13.2, 0.18, 12.8), materials.floor, [7.35, 0.61, 0.05], "field-floor");

  const leftCounterX = waypoints[0].x + 1.65;
  const rightCounterX = waypoints[4].x - 1.65;
  const laneLength = 11.8;
  addMesh(new THREE.BoxGeometry(2.65, 0.72, laneLength), materials.beltEdge, [leftCounterX, 1.02, 0.05], "left-conveyor-base");
  addMesh(new THREE.BoxGeometry(2.65, 0.72, laneLength), materials.beltEdge, [rightCounterX, 1.02, 0.05], "right-conveyor-base");
  addMesh(new THREE.BoxGeometry(2.35, 0.22, laneLength - 0.35), materials.belt, [leftCounterX, 1.48, 0.05], "left-conveyor-belt");
  addMesh(new THREE.BoxGeometry(2.35, 0.22, laneLength - 0.35), materials.belt, [rightCounterX, 1.48, 0.05], "right-conveyor-belt");
  addMesh(
    new THREE.BoxGeometry(rightCounterX - leftCounterX + 2.65, 0.72, 2.45),
    materials.beltEdge,
    [(leftCounterX + rightCounterX) / 2, 1.02, 5.28],
    "turn-conveyor-base",
  );
  addMesh(
    new THREE.BoxGeometry(rightCounterX - leftCounterX + 2.35, 0.22, 2.15),
    materials.belt,
    [(leftCounterX + rightCounterX) / 2, 1.48, 5.28],
    "turn-conveyor-belt",
  );

  waypoints.forEach((waypoint, index) => {
    const counterX = index < 4 ? leftCounterX : rightCounterX;
    addMesh(new THREE.BoxGeometry(2.5, 3.85, 1.82), materials.counter, [counterX, 3.45, waypoint.z], `station-${index + 1}-body`);
    addMesh(new THREE.BoxGeometry(2.72, 0.3, 2.02), materials.counterTop, [counterX, 5.53, waypoint.z], `station-${index + 1}-top`);
    addMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 24), materials.yellow, [counterX, 5.76, waypoint.z - 0.72], `station-${index + 1}-marker`);
  });

  const leftX = leftCounterX;
  const rightX = rightCounterX;
  const propY = 5.82;

  const meat = addMesh(new THREE.BoxGeometry(0.9, 0.22, 0.7), materials.red, [leftX, propY, waypoints[0].z], "prop-meat");
  meat.rotation.y = 0.18;
  addMesh(new THREE.CylinderGeometry(0.66, 0.62, 0.48, 24, 1, true), materials.steel, [leftX, propY + 0.18, waypoints[1].z], "prop-pot");
  addMesh(new THREE.CylinderGeometry(0.54, 0.54, 0.08, 24), materials.darkSteel, [leftX, propY - 0.02, waypoints[1].z], "prop-pot-bottom");

  [[-0.38, materials.red], [0, materials.green], [0.38, materials.orange]].forEach(([offset, material], itemIndex) => {
    addMesh(new THREE.SphereGeometry(0.28, 14, 10), material, [leftX + offset, propY + 0.18, waypoints[2].z], `prop-ingredient-${itemIndex + 1}`);
  });

  addMesh(new THREE.BoxGeometry(1.45, 0.18, 1.0), materials.wood, [leftX, propY, waypoints[3].z], "prop-cutting-board");
  addMesh(new THREE.BoxGeometry(0.15, 0.13, 1.05), materials.steel, [leftX + 0.2, propY + 0.16, waypoints[3].z], "prop-knife", [0, -0.42, 0]);

  addMesh(new THREE.CylinderGeometry(0.7, 0.52, 0.42, 24), materials.steel, [rightX, propY + 0.12, waypoints[4].z], "prop-mixing-bowl");
  addMesh(new THREE.CylinderGeometry(0.07, 0.07, 1.25, 12), materials.darkSteel, [rightX + 0.16, propY + 0.65, waypoints[4].z], "prop-whisk", [0.38, 0, -0.22]);

  [-0.38, 0, 0.38].forEach((offset, itemIndex) => {
    addMesh(new THREE.CylinderGeometry(0.2, 0.22, 0.72, 16), itemIndex === 1 ? materials.orange : materials.cream, [rightX + offset, propY + 0.36, waypoints[5].z], `prop-seasoning-${itemIndex + 1}`);
  });

  addMesh(new THREE.CylinderGeometry(0.78, 0.78, 0.14, 28), materials.cream, [rightX, propY, waypoints[6].z], "prop-plate");
  addMesh(new THREE.CylinderGeometry(0.53, 0.48, 0.26, 24), materials.orange, [rightX, propY + 0.18, waypoints[6].z], "prop-finished-dish");
  addMesh(new THREE.BoxGeometry(1.55, 0.18, 1.12), materials.beltEdge, [rightX, propY, waypoints[7].z], "prop-output-tray");
  [[-0.42, materials.green], [0, materials.orange], [0.42, materials.red]].forEach(([offset, material], itemIndex) => {
    addMesh(new THREE.SphereGeometry(0.23, 14, 10), material, [rightX + offset, propY + 0.28, waypoints[7].z], `prop-output-${itemIndex + 1}`);
  });

  return group;
}

function prepareRiggedCharacter(gltf) {
  const root = new THREE.Group();
  root.name = "rigged-cooking-scene";
  const pivot = new THREE.Group();
  pivot.rotation.y = DEFAULT_STAGE_YAW;
  root.add(pivot);

  const model = gltf.scene;
  const armature = model.getObjectByName("アーマチュア") || model;
  model.children.forEach((object) => {
    if (object !== armature && object.name !== "円柱.025") object.visible = false;
  });
  const characterBox = new THREE.Box3().setFromObject(armature);
  const characterSize = characterBox.getSize(new THREE.Vector3());
  const characterCenter = characterBox.getCenter(new THREE.Vector3());
  const normalizedScale = 2.15 / characterSize.y;
  model.scale.setScalar(normalizedScale);
  model.position.set(
    -characterCenter.x * normalizedScale,
    -characterBox.min.y * normalizedScale,
    -characterCenter.z * normalizedScale,
  );
  pivot.add(model);

  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.characterPart = false;
  });
  armature.traverse((object) => {
    if (object.isMesh) object.userData.characterPart = true;
  });

  const boneNames = [
    "neck", "head", "chest", "ninoude_L", "zenwan_L", "hand_L",
    "ninoude_R", "zenwan_R", "hand_R", "futomomo_L", "fukurahagi_L",
    "futomomo_R", "fukurahagi_R",
  ];
  const bones = {};
  const boneRest = {};
  boneNames.forEach((name) => {
    let bone = null;
    model.traverse((object) => {
      if (!bone && object.isBone && object.name === name) bone = object;
    });
    if (!bone) return;
    bones[name] = bone;
    boneRest[name] = bone.quaternion.clone();
  });

  const looseChefHat = model.getObjectByName("円柱.025");
  if (looseChefHat) looseChefHat.visible = false;

  const ingredientMaterial = new THREE.MeshStandardMaterial({ color: 0xef4b3f, roughness: 0.72 });
  const carriedIngredient = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), ingredientMaterial);
  carriedIngredient.name = "carried-ingredient";
  carriedIngredient.visible = false;
  carriedIngredient.castShadow = true;
  if (bones.hand_R) {
    carriedIngredient.position.set(0, -0.42, 0.12);
    bones.hand_R.add(carriedIngredient);
  }

  const mixer = new THREE.AnimationMixer(model);
  const walkClip = gltf.animations.find((clip) => clip.name === "walk_animetion") || gltf.animations[0];
  const cookingClip = gltf.animations.find((clip) => clip.name !== "walk_animetion") || gltf.animations[0];
  const walkAction = mixer.clipAction(walkClip);
  const cookingAction = mixer.clipAction(cookingClip);
  cookingAction.setLoop(THREE.LoopRepeat, Infinity).play();

  const armatureRestPosition = armature.position.clone();
  const armatureRestQuaternion = armature.quaternion.clone();
  const leftLaneX = armatureRestPosition.x;
  const rightLaneX = armatureRestPosition.x + 8.45;
  const routeY = armatureRestPosition.y;
  const waypoints = [
    new THREE.Vector3(leftLaneX, routeY, -5.15),
    new THREE.Vector3(leftLaneX, routeY, -1.75),
    new THREE.Vector3(leftLaneX, routeY, 1.75),
    new THREE.Vector3(leftLaneX, routeY, 5.25),
    new THREE.Vector3(rightLaneX, routeY, 5.25),
    new THREE.Vector3(rightLaneX, routeY, 1.75),
    new THREE.Vector3(rightLaneX, routeY, -1.75),
    new THREE.Vector3(rightLaneX, routeY, -5.15),
  ];
  model.add(createCookingField(waypoints));
  model.add(createRouteGuide(waypoints));
  const stations = [
    { label: "① お肉を取る", tools: [], toolChance: 0 },
    { label: "② 鍋で加熱する", tools: ["ladle", "spatula"], toolChance: 0.62 },
    { label: "③ 食材を取る", tools: [], toolChance: 0 },
    { label: "④ 食材を切る", tools: ["knife"], toolChance: 0.72 },
    { label: "⑤ 材料を混ぜる", tools: ["whisk", "ladle"], toolChance: 0.68 },
    { label: "⑥ 味付けする", tools: ["shaker"], toolChance: 0.58 },
    { label: "⑦ 盛り付ける", tools: ["ladle", "spatula"], toolChance: 0.55 },
    { label: "⑧ 料理を完成させる", tools: ["spatula"], toolChance: 0.25 },
  ];
  armature.position.copy(waypoints[0]);
  const tools = createHandTools(bones.hand_R);

  const riggedCharacter = {
    kind: "rigged",
    root,
    model,
    pivot,
    mixer,
    cookingAction,
    walkAction,
    activeAction: cookingAction,
    armature,
    armatureRestPosition,
    armatureRestQuaternion,
    carriedIngredient,
    ingredientMaterial,
    tools,
    motion: {
      phase: "cook",
      phaseStartedAt: performance.now(),
      waypointIndex: 0,
      from: waypoints[0].clone(),
      to: waypoints[0].clone(),
      waypoints,
      stations,
    },
    bones,
    boneRest,
    lastAnimationTime: performance.now(),
    groundOffset: 0,
    playRigAction(action) {
      if (this.activeAction === action && action.isRunning()) return;
      if (this.activeAction?.isRunning()) this.activeAction.fadeOut(0.25);
      action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.25).play();
      this.activeAction = action;
    },
    resetRigPose() {
      Object.entries(boneRest).forEach(([name, quaternion]) => bones[name]?.quaternion.copy(quaternion));
    },
  };

  chooseRiggedStationTool(riggedCharacter);
  return riggedCharacter;
}

function prepareVetnumCharacter(model) {
  const root = new THREE.Group();
  root.name = "vetnum-cook";

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const normalizedScale = 2.15 / size.y;
  model.scale.setScalar(normalizedScale);
  model.rotation.y = Math.PI / 2;
  model.position.set(-center.x * normalizedScale, -box.min.y * normalizedScale, -center.z * normalizedScale);
  root.add(model);

  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.userData.characterPart = true;
      if (object.material) object.material.side = THREE.FrontSide;
    }
  });

  const named = {};
  ["body", "head", "arm_left", "arm_right", "hand_left", "hand_right", "foot_left", "foot_right"].forEach((name) => {
    named[name] = model.getObjectByName(name);
  });

  const pose = {};
  Object.entries(named).forEach(([name, object]) => {
    if (!object) return;
    pose[name] = {
      position: object.position.clone(),
      rotation: object.rotation.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    };
  });

  const cooking = createCookingSet();
  root.add(cooking.group);

  return {
    kind: "vetnum",
    root,
    model,
    cooking,
    pose,
    groundOffset: 0,
    body: named.body || root,
    head: named.head || root,
    leftArm: named.arm_left || root,
    rightArm: named.arm_right || root,
    leftHand: named.hand_left,
    rightHand: named.hand_right,
    leftFoot: named.foot_left || root,
    rightFoot: named.foot_right || root,
    tail: root,
    resetCustomPose() {
      Object.entries(pose).forEach(([name, original]) => {
        const object = named[name];
        if (!object) return;
        object.position.copy(original.position);
        object.rotation.copy(original.rotation);
        object.scale.copy(original.scale);
      });
      cooking.group.rotation.set(0, 0, 0);
      cooking.group.position.set(0, 0, 0);
      cooking.group.visible = true;
      cooking.spoon.rotation.set(0.15, 0, -0.45);
    },
  };
}

function createCookingSet() {
  const group = new THREE.Group();
  group.name = "cooking-set";
  group.position.set(0, 0, 0);

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.2, 0.22, 36, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xfff4d6, roughness: 0.48, metalness: 0.03, side: THREE.DoubleSide }),
  );
  bowl.position.set(0, 0.58, 0.64);
  bowl.castShadow = true;
  group.add(bowl);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.025, 10, 36),
    new THREE.MeshStandardMaterial({ color: 0xff8b45, roughness: 0.55 }),
  );
  rim.position.set(0, 0.69, 0.64);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  const mixture = new THREE.Mesh(
    new THREE.CircleGeometry(0.285, 36),
    new THREE.MeshStandardMaterial({ color: 0xf0b95c, roughness: 0.9, side: THREE.DoubleSide }),
  );
  mixture.position.set(0, 0.695, 0.64);
  mixture.rotation.x = -Math.PI / 2;
  group.add(mixture);

  const spoon = new THREE.Group();
  spoon.position.set(0.05, 0.86, 0.63);
  spoon.rotation.set(0.15, 0, -0.45);
  const handle = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.025, 0.52, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xc7d0da, roughness: 0.28, metalness: 0.72 }),
  );
  const spoonHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 18, 12),
    handle.material,
  );
  spoonHead.position.y = -0.31;
  spoonHead.scale.set(0.72, 1, 0.32);
  spoon.add(handle, spoonHead);
  group.add(spoon);

  group.traverse((object) => {
    if (object.isMesh) object.userData.characterPart = true;
  });
  return { group, bowl, mixture, spoon };
}

function material(color, roughness = 0.65) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function mesh(geometry, mat, parent, position, scale = [1, 1, 1]) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(...position);
  item.scale.set(...scale);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function createCharacter() {
  const root = new THREE.Group();
  root.name = "poko";
  root.scale.setScalar(0.68);

  const yellow = material(0xffcc2e, 0.7);
  const cream = material(0xffefc2, 0.85);
  const brown = material(0x4b301e, 0.9);
  const pink = material(0xff768e, 0.75);
  const white = material(0xffffff, 0.7);
  const black = material(0x17151a, 0.7);

  const body = mesh(new THREE.SphereGeometry(0.62, 32, 24), yellow, root, [0, 0.68, 0], [0.94, 1.08, 0.86]);
  mesh(new THREE.SphereGeometry(0.42, 28, 20), cream, body, [0, -0.12, 0.48], [0.9, 0.88, 0.22]);

  const head = new THREE.Group();
  head.position.set(0, 1.52, 0);
  root.add(head);
  mesh(new THREE.SphereGeometry(0.68, 32, 24), yellow, head, [0, 0, 0], [1.05, 0.9, 0.92]);

  const earGeometry = new THREE.ConeGeometry(0.24, 0.7, 20);
  const leftEar = mesh(earGeometry, yellow, head, [-0.42, 0.61, -0.02], [0.9, 1, 0.7]);
  leftEar.rotation.z = -0.22;
  const rightEar = mesh(earGeometry, yellow, head, [0.42, 0.61, -0.02], [0.9, 1, 0.7]);
  rightEar.rotation.z = 0.22;
  mesh(new THREE.ConeGeometry(0.13, 0.3, 16), brown, leftEar, [0, 0.22, 0]);
  mesh(new THREE.ConeGeometry(0.13, 0.3, 16), brown, rightEar, [0, 0.22, 0]);

  const leftEye = mesh(new THREE.SphereGeometry(0.105, 20, 16), black, head, [-0.23, 0.07, 0.58], [0.78, 1.1, 0.45]);
  const rightEye = mesh(new THREE.SphereGeometry(0.105, 20, 16), black, head, [0.23, 0.07, 0.58], [0.78, 1.1, 0.45]);
  mesh(new THREE.SphereGeometry(0.035, 12, 10), white, leftEye, [-0.015, 0.035, 0.08]);
  mesh(new THREE.SphereGeometry(0.035, 12, 10), white, rightEye, [-0.015, 0.035, 0.08]);
  mesh(new THREE.SphereGeometry(0.075, 16, 12), brown, head, [0, -0.12, 0.64], [1, 0.75, 0.55]);

  const mouth = mesh(new THREE.TorusGeometry(0.105, 0.018, 8, 18, Math.PI), brown, head, [0, -0.22, 0.63]);
  mouth.rotation.z = Math.PI;
  const leftCheek = mesh(new THREE.SphereGeometry(0.115, 18, 14), pink, head, [-0.43, -0.13, 0.5], [1, 0.55, 0.35]);
  const rightCheek = mesh(new THREE.SphereGeometry(0.115, 18, 14), pink, head, [0.43, -0.13, 0.5], [1, 0.55, 0.35]);

  const armGeometry = new THREE.CapsuleGeometry(0.15, 0.45, 8, 16);
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.58, 0.94, 0);
  root.add(leftArm);
  const leftArmMesh = mesh(armGeometry, yellow, leftArm, [0, -0.3, 0]);
  leftArm.rotation.z = -0.28;

  const rightArm = new THREE.Group();
  rightArm.position.set(0.58, 0.94, 0);
  root.add(rightArm);
  mesh(armGeometry, yellow, rightArm, [0, -0.3, 0]);
  rightArm.rotation.z = 0.28;

  const footGeometry = new THREE.SphereGeometry(0.28, 22, 16);
  const leftFoot = mesh(footGeometry, brown, root, [-0.31, 0.08, 0.06], [1, 0.58, 1.4]);
  const rightFoot = mesh(footGeometry, brown, root, [0.31, 0.08, 0.06], [1, 0.58, 1.4]);

  const tail = new THREE.Group();
  tail.position.set(0.52, 0.72, -0.22);
  root.add(tail);
  const tailMesh = mesh(new THREE.ConeGeometry(0.24, 0.95, 16), yellow, tail, [0.35, 0.25, -0.1], [0.65, 1, 0.5]);
  tailMesh.rotation.z = -1.05;

  root.traverse((object) => {
    if (object.isMesh) object.userData.characterPart = true;
  });

  return {
    kind: "built-in",
    groundOffset: 0.083,
    root,
    body,
    head,
    leftArm,
    rightArm,
    leftEye,
    rightEye,
    leftCheek,
    rightCheek,
    leftFoot,
    rightFoot,
    tail,
  };
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

function resetPose() {
  const characterScale = state.mode === "qr" ? 0.18 : state.mode === "ar" ? 0.24 : 0.68;
  character.root.rotation.set(0, 0, 0);
  character.root.position.set(0, (character.groundOffset || 0) * characterScale, 0);
  character.root.scale.setScalar(characterScale);
  if (character.kind === "rigged") {
    character.resetRigPose();
    return;
  }
  if (character.kind === "vetnum") {
    character.resetCustomPose();
    return;
  }
  character.head.rotation.set(0, 0, 0);
  character.leftArm.rotation.set(0, 0, -0.28);
  character.rightArm.rotation.set(0, 0, 0.28);
  character.leftFoot.rotation.set(0, 0, 0);
  character.rightFoot.rotation.set(0, 0, 0);
}

function animateCharacter(time) {
  const seconds = time / 1000;
  const idleBob = Math.sin(seconds * 2.2) * 0.025;
  const characterScale = state.mode === "qr" ? 0.18 : state.mode === "ar" ? 0.24 : 0.68;
  const baseY = (character.groundOffset || 0) * characterScale;

  if (character.kind === "rigged") {
    animateRiggedCharacter(time, baseY, characterScale);
    return;
  }

  if (character.kind === "vetnum") {
    animateCookingCharacter(seconds, baseY, characterScale);
    return;
  }

  if (!state.action) {
    character.root.position.y = baseY + idleBob;
    character.body.scale.y = 1 + Math.sin(seconds * 2.2) * 0.025;
    character.head.rotation.y = Math.sin(seconds * 0.75) * 0.16;
    character.tail.rotation.z = Math.sin(seconds * 3) * 0.16;
    character.leftArm.rotation.x = Math.sin(seconds * 1.5) * 0.08;
    character.rightArm.rotation.x = -Math.sin(seconds * 1.5) * 0.08;
    return;
  }

  const duration = state.action === "jump" ? 1100 : state.action === "spin" ? 1250 : 1600;
  const progress = Math.min((performance.now() - state.actionStartedAt) / duration, 1);

  if (state.action === "jump") {
    character.root.position.y = baseY + Math.sin(progress * Math.PI) * 0.72;
    const squash = Math.sin(progress * Math.PI);
    character.root.scale.y = characterScale * (1 + squash * 0.15);
    character.root.scale.x = characterScale * (1 - squash * 0.06);
  } else if (state.action === "spin") {
    character.root.rotation.y = easeOutBack(progress) * Math.PI * 2;
    character.root.position.y = baseY + Math.sin(progress * Math.PI) * 0.18;
  } else {
    character.rightArm.rotation.z = 0.35 + Math.sin(progress * Math.PI * 8) * 0.75;
    character.rightArm.rotation.x = -1.85;
    character.head.rotation.z = Math.sin(progress * Math.PI * 4) * 0.12;
    character.root.position.y = baseY + Math.sin(progress * Math.PI * 4) * 0.035;
  }

  if (progress >= 1) {
    state.action = null;
    resetPose();
  }
}

function applyRetargetedBone(targetName, sourceName, strength = 0.35) {
  const target = character.bones[targetName];
  const rest = character.boneRest[targetName];
  if (!target || !rest) return;
  const weighted = new THREE.Quaternion().slerp(animationDelta(sourceName), strength);
  target.quaternion.copy(rest).multiply(weighted);
}

function updateRiggedRoaming(now) {
  const motion = character.motion;
  const elapsed = (now - motion.phaseStartedAt) / 1000;

  if (motion.phase === "cook") {
    character.playRigAction(character.cookingAction);
    const isPickupStation = motion.waypointIndex === 0 || motion.waypointIndex === 2;
    character.carriedIngredient.visible = isPickupStation && elapsed > 0.55;
    character.armature.position.y = character.armatureRestPosition.y;
    const stationTurn = motion.waypointIndex >= 4 ? Math.PI : 0;
    const stationRotation = character.armatureRestQuaternion.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), stationTurn),
    );
    character.armature.quaternion.slerp(stationRotation, 0.09);

    const cookDuration = 2.5 + (motion.waypointIndex % 3) * 0.45;
    if (elapsed >= cookDuration) {
      motion.phase = "walk";
      motion.phaseStartedAt = now;
      motion.from.copy(character.armature.position);
      motion.waypointIndex = (motion.waypointIndex + 1) % motion.waypoints.length;
      motion.to.copy(motion.waypoints[motion.waypointIndex]);
      hideRiggedTools(character);
      const ingredientColors = [0xef4b3f, 0xffc83d, 0x70b957, 0xe992bc, 0xf28f3b];
      character.ingredientMaterial.color.setHex(ingredientColors[motion.waypointIndex]);
      character.carriedIngredient.visible = true;
      character.playRigAction(character.walkAction);
      if (state.mode === "qr") {
        ui.bubble.textContent = `次は ${motion.stations[motion.waypointIndex].label.slice(2)}`;
      }
    }
    return;
  }

  character.playRigAction(character.walkAction);
  character.carriedIngredient.visible = true;
  const distance = motion.from.distanceTo(motion.to);
  const walkDuration = Math.max(1.15, distance * 0.62);
  const progress = Math.min(elapsed / walkDuration, 1);
  const smooth = progress * progress * (3 - 2 * progress);
  character.armature.position.lerpVectors(motion.from, motion.to, smooth);
  character.armature.position.y = character.armatureRestPosition.y;

  const direction = motion.to.clone().sub(motion.from);
  if (direction.lengthSq() > 0.001) {
    const heading = Math.atan2(direction.x, direction.z);
    const targetRotation = character.armatureRestQuaternion.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading),
    );
    character.armature.quaternion.slerp(targetRotation, 0.14);
  }

  if (progress >= 1) {
    motion.phase = "cook";
    motion.phaseStartedAt = now;
    character.playRigAction(character.cookingAction);
    character.carriedIngredient.visible = false;
    chooseRiggedStationTool(character);
    if (state.mode === "qr") ui.bubble.textContent = motion.stations[motion.waypointIndex].label;
  }
}

function animateRiggedCharacter(time, baseY, characterScale) {
  character.root.position.y = baseY;
  if (state.action === "fbx" && tapMotion) {
    const elapsed = (performance.now() - state.actionStartedAt) / 1000;
    tapMotion.mixer.setTime(Math.min(elapsed, tapMotion.clip.duration));
    applyRetargetedBone("head", "mixamorigHead", 0.42);
    applyRetargetedBone("chest", "mixamorigSpine2", 0.35);
    applyRetargetedBone("ninoude_L", "mixamorigLeftArm", 0.38);
    applyRetargetedBone("zenwan_L", "mixamorigLeftForeArm", 0.42);
    applyRetargetedBone("hand_L", "mixamorigLeftHand", 0.35);
    applyRetargetedBone("ninoude_R", "mixamorigRightArm", 0.38);
    applyRetargetedBone("zenwan_R", "mixamorigRightForeArm", 0.42);
    applyRetargetedBone("hand_R", "mixamorigRightHand", 0.35);
    applyRetargetedBone("futomomo_L", "mixamorigLeftUpLeg", 0.28);
    applyRetargetedBone("fukurahagi_L", "mixamorigLeftLeg", 0.25);
    applyRetargetedBone("futomomo_R", "mixamorigRightUpLeg", 0.28);
    applyRetargetedBone("fukurahagi_R", "mixamorigRightLeg", 0.25);

    if (elapsed >= tapMotion.clip.duration) {
      tapMotion.mixer.stopAllAction();
      state.action = null;
      character.resetRigPose();
      character.lastAnimationTime = time;
      character.motion.phase = "cook";
      character.motion.phaseStartedAt = performance.now();
      character.motion.from.copy(character.armature.position);
      character.motion.to.copy(character.armature.position);
      character.activeAction = null;
      character.playRigAction(character.cookingAction);
      chooseRiggedStationTool(character);
      showMessage("お料理にもどるよ！");
    }
    return;
  }

  updateRiggedRoaming(performance.now());
  const delta = Math.min((time - character.lastAnimationTime) / 1000, 0.05);
  character.lastAnimationTime = time;
  character.mixer.update(Math.max(delta, 0));
}

function animateCookingCharacter(seconds, baseY, characterScale) {
  if (state.action === "fbx" && tapMotion) {
    animateTapMotion(baseY, characterScale);
    return;
  }

  const pose = character.pose;
  const stirSpeed = 4.2;
  const stir = seconds * stirSpeed;
  const sway = Math.sin(seconds * 2.2) * 0.035;

  character.root.position.y = baseY + Math.sin(seconds * 2.4) * 0.008;
  character.root.rotation.y = sway;

  if (character.leftArm && pose.arm_left) {
    character.leftArm.position.copy(pose.arm_left.position);
    character.leftArm.position.y += Math.sin(stir) * 2.2;
    character.leftArm.position.x += Math.cos(stir) * 1.15;
    character.leftArm.rotation.copy(pose.arm_left.rotation);
    character.leftArm.rotation.z += Math.sin(stir) * 0.18;
  }
  if (character.rightArm && pose.arm_right) {
    character.rightArm.position.copy(pose.arm_right.position);
    character.rightArm.position.y += Math.sin(stir + Math.PI) * 1.9;
    character.rightArm.position.x += Math.cos(stir + Math.PI) * 1.05;
    character.rightArm.rotation.copy(pose.arm_right.rotation);
    character.rightArm.rotation.z -= Math.sin(stir) * 0.16;
  }
  if (character.leftHand && pose.hand_left) {
    character.leftHand.position.copy(pose.hand_left.position);
    character.leftHand.position.y += Math.sin(stir) * 2.05;
    character.leftHand.position.x += Math.cos(stir) * 0.95;
  }
  if (character.rightHand && pose.hand_right) {
    character.rightHand.position.copy(pose.hand_right.position);
    character.rightHand.position.y += Math.sin(stir + Math.PI) * 1.85;
    character.rightHand.position.x += Math.cos(stir + Math.PI) * 0.9;
  }
  if (character.head && pose.head) {
    character.head.rotation.copy(pose.head.rotation);
    character.head.rotation.z += Math.sin(seconds * 1.8) * 0.035;
  }

  character.cooking.spoon.rotation.y = stir;
  character.cooking.spoon.position.x = 0.05 + Math.cos(stir) * 0.1;
  character.cooking.spoon.position.z = 0.63 + Math.sin(stir) * 0.07;
  character.cooking.mixture.scale.setScalar(1 + Math.sin(stir * 2) * 0.025);

  character.cooking.spoon.position.y = 0.86;
  character.cooking.spoon.rotation.x = 0.15;
  character.cooking.group.position.set(0, 0, 0);
}

function animationDelta(name) {
  const bone = tapMotion?.bones[name];
  const rest = tapMotion?.rest[name];
  if (!bone || !rest) return new THREE.Quaternion();
  return rest.quaternion.clone().invert().multiply(bone.quaternion);
}

function animationEuler(name) {
  return new THREE.Euler().setFromQuaternion(animationDelta(name), "XYZ");
}

function applyMotionToPart(part, pose, boneName, strength = 1) {
  if (!part || !pose?.quaternion) return;
  const weightedDelta = new THREE.Quaternion().slerp(animationDelta(boneName), strength);
  part.quaternion.copy(pose.quaternion).multiply(weightedDelta);
}

function animateTapMotion(baseY, characterScale) {
  const elapsed = (performance.now() - state.actionStartedAt) / 1000;
  const duration = tapMotion.clip.duration;
  tapMotion.mixer.setTime(Math.min(elapsed, duration));
  character.cooking.group.visible = false;

  applyMotionToPart(character.head, character.pose.head, "mixamorigHead", 0.38);

  const leftMotion = animationEuler("mixamorigLeftArm");
  const rightMotion = animationEuler("mixamorigRightArm");
  const leftOffset = new THREE.Vector3(leftMotion.z * 1.2, leftMotion.x * 1.6, leftMotion.y * 0.8);
  const rightOffset = new THREE.Vector3(rightMotion.z * 1.2, rightMotion.x * 1.6, rightMotion.y * 0.8);

  if (character.leftArm && character.pose.arm_left) {
    character.leftArm.position.copy(character.pose.arm_left.position).add(leftOffset);
    applyMotionToPart(character.leftArm, character.pose.arm_left, "mixamorigLeftArm", 0.12);
  }
  if (character.leftHand && character.pose.hand_left) {
    character.leftHand.position.copy(character.pose.hand_left.position).add(leftOffset);
    character.leftHand.quaternion.copy(character.pose.hand_left.quaternion);
  }
  if (character.rightArm && character.pose.arm_right) {
    character.rightArm.position.copy(character.pose.arm_right.position).add(rightOffset);
    applyMotionToPart(character.rightArm, character.pose.arm_right, "mixamorigRightArm", 0.12);
  }
  if (character.rightHand && character.pose.hand_right) {
    character.rightHand.position.copy(character.pose.hand_right.position).add(rightOffset);
    character.rightHand.quaternion.copy(character.pose.hand_right.quaternion);
  }

  const leftLegMotion = animationEuler("mixamorigLeftLeg");
  const rightLegMotion = animationEuler("mixamorigRightLeg");
  if (character.leftFoot && character.pose.foot_left) {
    character.leftFoot.position.copy(character.pose.foot_left.position);
    character.leftFoot.position.y += Math.sin(leftLegMotion.x) * 0.35;
    applyMotionToPart(character.leftFoot, character.pose.foot_left, "mixamorigLeftLeg", 0.1);
  }
  if (character.rightFoot && character.pose.foot_right) {
    character.rightFoot.position.copy(character.pose.foot_right.position);
    character.rightFoot.position.y += Math.sin(rightLegMotion.x) * 0.35;
    applyMotionToPart(character.rightFoot, character.pose.foot_right, "mixamorigRightLeg", 0.1);
  }

  const hips = tapMotion.bones.mixamorigHips;
  const restHips = tapMotion.rest.mixamorigHips;
  const verticalMotion = hips && restHips ? (hips.position.y - restHips.position.y) / 180 : 0;
  character.root.position.y = baseY + verticalMotion * 2.15 * characterScale;
  character.root.rotation.y = Math.sin(elapsed * 1.4) * 0.025;

  if (elapsed >= duration) {
    tapMotion.mixer.stopAllAction();
    state.action = null;
    showMessage("お料理にもどるよ！");
    resetPose();
  }
}

function triggerAction() {
  if (state.action) return;
  if (character.kind === "vetnum" || character.kind === "rigged") {
    if (!tapMotion) {
      showMessage("動きを読み込み中…");
      return;
    }
    state.action = "fbx";
    state.actionStartedAt = performance.now();
    if (character.kind === "rigged") {
      character.mixer.stopAllAction();
      character.activeAction = null;
      character.carriedIngredient.visible = false;
      hideRiggedTools(character);
    }
    tapMotion.mixer.stopAllAction();
    tapMotion.action.reset().setLoop(THREE.LoopOnce, 1).play();
    showMessage("ちょっとひとやすみ♪");
    playChime();
    ui.flash.classList.remove("active");
    void ui.flash.offsetWidth;
    ui.flash.classList.add("active");
    return;
  }

  const actions = ["jump", "spin", "wave"];
  const messages = ["わーい！", "くるりん！", "こんにちは！"];
  state.action = actions[state.actionIndex % actions.length];
  state.actionStartedAt = performance.now();
  showMessage(messages[state.actionIndex % messages.length]);
  state.actionIndex += 1;
  playChime();
  ui.flash.classList.remove("active");
  void ui.flash.offsetWidth;
  ui.flash.classList.add("active");
}

function showMessage(message) {
  ui.bubble.textContent = message;
  ui.bubble.classList.add("pop");
  setTimeout(() => ui.bubble.classList.remove("pop"), 260);
  setTimeout(() => {
    if (!state.action) ui.bubble.textContent = "もう一度タップしてね！";
  }, 1700);
}

function playChime() {
  if (!state.sound) return;
  audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
  const now = audioContext.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.07);
    gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.07 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.22);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now + index * 0.07);
    oscillator.stop(now + index * 0.07 + 0.24);
  });
}

function hitCharacterFromScreen(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(character.root, true).some((hit) => hit.object.userData.characterPart);
}

async function startExperience() {
  ui.welcome.classList.add("hidden");
  ui.error.classList.add("hidden");
  audioContext ??= new (window.AudioContext || window.webkitAudioContext)();

  await startQRTracking();
}

async function startWebXR() {
  try {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "light-estimation"],
      domOverlay: { root: document.body },
    });
    state.mode = "ar";
    state.placed = false;
    character.root.visible = false;
    ground.visible = false;
    ui.guide.classList.remove("hidden");
    await renderer.xr.setSession(session);

    const controller = renderer.xr.getController(0);
    controller.addEventListener("select", onXRSelect);
    scene.add(controller);
    session.addEventListener("end", stopExperience);
    renderer.setAnimationLoop(render);
  } catch (error) {
    console.warn("WebXR start failed; using camera fallback.", error);
    await startQRTracking();
  }
}

function onXRSelect() {
  if (!state.placed && reticle.visible) {
    reticle.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
    anchor.scale.setScalar(1);
    resetPose();
    character.root.visible = true;
    ground.visible = true;
    state.placed = true;
    reticle.visible = false;
    ui.guide.classList.add("hidden");
    ui.interaction.classList.remove("hidden");
    playChime();
    return;
  }
  if (state.placed) triggerAction();
}

async function startQRTracking() {
  state.mode = "qr";
  state.placed = false;
  state.targetQrData = null;
  state.userYaw = DEFAULT_STAGE_YAW;
  qrTracker.lastScanAt = 0;
  qrTracker.lastSeenAt = 0;
  anchor.position.set(0, -0.96, 0);
  anchor.quaternion.identity();
  anchor.scale.setScalar(1);
  if (character.kind === "rigged") character.pivot.rotation.y = state.userYaw;
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  character.root.visible = false;
  ground.visible = false;
  resetPose();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  ui.video.srcObject = stream;
  await ui.video.play();
  document.body.classList.add("camera-active");

  ui.guideText.innerHTML = "QRコードを地面に置いて<br />カメラに映してください";
  ui.guide.classList.remove("hidden");
  ui.interaction.classList.add("hidden");
  renderer.setAnimationLoop(render);
}

function mapVideoPointToScreen(point, videoWidth, videoHeight) {
  const coverScale = Math.max(innerWidth / videoWidth, innerHeight / videoHeight);
  const offsetX = (innerWidth - videoWidth * coverScale) / 2;
  const offsetY = (innerHeight - videoHeight * coverScale) / 2;
  return new THREE.Vector2(point.x * coverScale + offsetX, point.y * coverScale + offsetY);
}

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-9) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= size; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= size; index += 1) {
        rows[row][index] -= factor * rows[column][index];
      }
    }
  }
  return rows.map((row) => row[size]);
}

function estimateMarkerPose(screenPoints) {
  const focalLength = 0.5 * innerHeight / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const imagePoints = screenPoints.map((point) => ({
    x: (point.x - innerWidth / 2) / focalLength,
    y: -(point.y - innerHeight / 2) / focalLength,
  }));
  const half = 0.132 / 2;
  const markerPoints = [
    { x: -half, y: half },
    { x: half, y: half },
    { x: half, y: -half },
    { x: -half, y: -half },
  ];

  const matrix = [];
  const values = [];
  markerPoints.forEach((marker, index) => {
    const image = imagePoints[index];
    matrix.push([marker.x, marker.y, 1, 0, 0, 0, -image.x * marker.x, -image.x * marker.y]);
    values.push(image.x);
    matrix.push([0, 0, 0, marker.x, marker.y, 1, -image.y * marker.x, -image.y * marker.y]);
    values.push(image.y);
  });
  const h = solveLinearSystem(matrix, values);
  if (!h) return null;

  const h1 = new THREE.Vector3(h[0], h[3], h[6]);
  const h2 = new THREE.Vector3(h[1], h[4], h[7]);
  const h3 = new THREE.Vector3(h[2], h[5], 1);
  let scale = 2 / (h1.length() + h2.length());
  if (h3.z * scale < 0) scale *= -1;

  const r1 = h1.multiplyScalar(scale).normalize();
  const r2 = h2.multiplyScalar(scale);
  r2.addScaledVector(r1, -r1.dot(r2)).normalize();
  const r3 = new THREE.Vector3().crossVectors(r1, r2).normalize();
  const translationCV = h3.multiplyScalar(scale);

  const toThree = (vector) => new THREE.Vector3(vector.x, vector.y, -vector.z);
  const xAxis = toThree(r1).normalize();
  // QR's detected normal points through the printed sheet. Flip both local Y and Z
  // so the visible side of the QR becomes the stage's upward-facing surface.
  const yAxis = toThree(r3).multiplyScalar(-1).normalize();
  const zAxis = toThree(r2).multiplyScalar(-1).normalize();
  const rotationMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);

  return {
    position: toThree(translationCV),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(rotationMatrix).normalize(),
  };
}

function updateQRAnchor(code, sourceScale) {
  const raw = code.location;
  const points = [raw.topLeftCorner, raw.topRightCorner, raw.bottomRightCorner, raw.bottomLeftCorner]
    .map((point) => ({ x: point.x * sourceScale, y: point.y * sourceScale }))
    .map((point) => mapVideoPointToScreen(point, ui.video.videoWidth, ui.video.videoHeight));

  const pose = estimateMarkerPose(points);
  if (!pose || !Number.isFinite(pose.position.z)) return;
  const cameraDistance = pose.position.length();
  const targetSceneScale = THREE.MathUtils.clamp(cameraDistance / 1.8, 0.34, 1.6);

  if (!state.placed) {
    anchor.position.copy(pose.position);
    anchor.quaternion.copy(pose.quaternion);
    anchor.scale.setScalar(targetSceneScale);
  } else {
    const distance = anchor.position.distanceTo(pose.position);
    anchor.position.lerp(pose.position, distance > 0.5 ? 0.65 : 0.22);
    anchor.quaternion.slerp(pose.quaternion, 0.18);
    const nextScale = THREE.MathUtils.lerp(anchor.scale.x, targetSceneScale, 0.16);
    anchor.scale.setScalar(nextScale);
  }
  character.root.visible = true;
  ground.visible = true;
  state.placed = true;
  qrTracker.lastSeenAt = performance.now();
  ui.guide.classList.add("hidden");
  ui.interaction.classList.remove("hidden");
}

function scanQRCode(time) {
  if (time - qrTracker.lastScanAt < 110 || ui.video.readyState < 2 || !window.jsQR) return;
  qrTracker.lastScanAt = time;

  const sourceWidth = ui.video.videoWidth;
  const sourceHeight = ui.video.videoHeight;
  const scanWidth = Math.min(520, sourceWidth);
  const scanHeight = Math.round(scanWidth * sourceHeight / sourceWidth);
  if (!scanWidth || !scanHeight) return;
  if (qrTracker.canvas.width !== scanWidth || qrTracker.canvas.height !== scanHeight) {
    qrTracker.canvas.width = scanWidth;
    qrTracker.canvas.height = scanHeight;
  }
  qrTracker.context.drawImage(ui.video, 0, 0, scanWidth, scanHeight);
  const image = qrTracker.context.getImageData(0, 0, scanWidth, scanHeight);
  const code = window.jsQR(image.data, scanWidth, scanHeight, { inversionAttempts: "dontInvert" });

  if (code) {
    state.targetQrData ||= code.data;
    if (code.data === state.targetQrData) updateQRAnchor(code, sourceWidth / scanWidth);
  }

  if (state.placed && time - qrTracker.lastSeenAt > 650) {
    state.placed = false;
    character.root.visible = false;
    ground.visible = false;
    ui.interaction.classList.add("hidden");
    ui.guideText.innerHTML = "QRコードをもう一度<br />カメラに映してください";
    ui.guide.classList.remove("hidden");
  }
}

function stopExperience() {
  renderer.setAnimationLoop(render);
  state.mode = "preview";
  state.placed = true;
  anchor.position.set(0, -0.96, 0);
  anchor.quaternion.identity();
  anchor.scale.setScalar(1);
  camera.position.set(0, 0.15, 4.2);
  camera.rotation.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  character.root.visible = true;
  ground.visible = true;
  resetPose();
}

function render(time, frame) {
  if (state.mode === "qr") scanQRCode(time);
  if (frame && state.mode === "ar" && !state.placed) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();
    if (!state.hitTestRequested) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          state.hitTestSource = source;
        });
      });
      session.addEventListener("end", () => {
        state.hitTestRequested = false;
        state.hitTestSource = null;
      });
      state.hitTestRequested = true;
    }
    if (state.hitTestSource) {
      const results = frame.getHitTestResults(state.hitTestSource);
      reticle.visible = results.length > 0;
      if (results.length) {
        const pose = results[0].getPose(referenceSpace);
        reticle.matrix.fromArray(pose.transform.matrix);
        ui.guideText.innerHTML = "黄色い円をタップして<br />キャラクターを置いてください";
      }
    }
  }

  animateCharacter(time);
  renderer.render(scene, camera);
}

function showError(error) {
  console.error(error);
  ui.welcome.classList.add("hidden");
  ui.guide.classList.add("hidden");
  ui.interaction.classList.add("hidden");
  ui.error.classList.remove("hidden");
  ui.errorMessage.textContent =
    error?.name === "NotAllowedError"
      ? "カメラの利用が許可されていません。ブラウザの設定でカメラを許可してください。"
      : "カメラまたはARを開始できませんでした。ページを再読み込みしてお試しください。";
}

ui.start.addEventListener("click", () => startExperience().catch(showError));
ui.retry.addEventListener("click", () => startExperience().catch(showError));
ui.sound.addEventListener("click", () => {
  state.sound = !state.sound;
  ui.sound.textContent = state.sound ? "♪" : "×";
  ui.sound.setAttribute("aria-label", state.sound ? "音をオフにする" : "音をオンにする");
  if (state.sound) playChime();
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (state.mode === "ar" || !state.placed) return;
  gesture.pointerId = event.pointerId;
  gesture.startX = event.clientX;
  gesture.startY = event.clientY;
  gesture.startYaw = state.userYaw;
  gesture.moved = false;
  renderer.domElement.setPointerCapture?.(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (gesture.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - gesture.startX;
  const deltaY = event.clientY - gesture.startY;
  if (Math.hypot(deltaX, deltaY) > 7) gesture.moved = true;
  if (!gesture.moved || character.kind !== "rigged") return;
  state.userYaw = gesture.startYaw + deltaX * 0.007;
  character.pivot.rotation.y = state.userYaw;
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (gesture.pointerId !== event.pointerId) return;
  const wasMoved = gesture.moved;
  gesture.pointerId = null;
  renderer.domElement.releasePointerCapture?.(event.pointerId);
  if (!wasMoved && state.mode !== "ar" && state.placed && hitCharacterFromScreen(event.clientX, event.clientY)) {
    triggerAction();
  }
});

renderer.domElement.addEventListener("pointercancel", () => {
  gesture.pointerId = null;
  gesture.moved = false;
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (new URLSearchParams(location.search).get("preview") === "1") {
  state.placed = true;
  ui.welcome.classList.add("hidden");
  ui.guide.classList.add("hidden");
  ui.interaction.classList.add("hidden");
}

renderer.setAnimationLoop(render);
