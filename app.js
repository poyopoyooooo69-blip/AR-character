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

const state = {
  mode: "preview",
  placed: false,
  action: null,
  actionStartedAt: 0,
  actionIndex: 0,
  sound: true,
  hitTestSource: null,
  hitTestRequested: false,
};

let tapMotion = null;

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
      "mixamorigHips", "mixamorigSpine", "mixamorigNeck", "mixamorigHead",
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
    const replacement = prepareVetnumCharacter(gltf.scene);
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
  const characterScale = state.mode === "ar" ? 0.24 : 0.68;
  character.root.rotation.set(0, 0, 0);
  character.root.position.set(0, (character.groundOffset || 0) * characterScale, 0);
  character.root.scale.setScalar(characterScale);
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
  const characterScale = state.mode === "ar" ? 0.24 : 0.68;
  const baseY = (character.groundOffset || 0) * characterScale;

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
  if (character.kind === "vetnum") {
    if (!tapMotion) {
      showMessage("動きを読み込み中…");
      return;
    }
    state.action = "fbx";
    state.actionStartedAt = performance.now();
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

  const canUseWebXR =
    window.isSecureContext &&
    navigator.xr &&
    (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));

  if (canUseWebXR) {
    await startWebXR();
  } else {
    await startCameraFallback();
  }
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
    await startCameraFallback();
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

async function startCameraFallback() {
  state.mode = "camera";
  state.placed = true;
  anchor.position.set(0, -0.96, 0);
  anchor.quaternion.identity();
  anchor.scale.setScalar(1);
  character.root.visible = true;
  ground.visible = true;
  resetPose();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    ui.video.srcObject = stream;
    await ui.video.play();
    document.body.classList.add("camera-active");
  } catch (error) {
    console.warn("Camera unavailable; keeping 3D preview.", error);
    if (!["NotAllowedError", "NotFoundError", "NotReadableError"].includes(error.name)) {
      throw error;
    }
    ui.guideText.innerHTML = "カメラなしのプレビューモードです";
  }

  ui.guide.classList.add("hidden");
  ui.interaction.classList.remove("hidden");
  renderer.setAnimationLoop(render);
  playChime();
}

function stopExperience() {
  renderer.setAnimationLoop(render);
  state.mode = "preview";
  state.placed = true;
  anchor.position.set(0, -0.96, 0);
  anchor.quaternion.identity();
  anchor.scale.setScalar(1);
  character.root.visible = true;
  ground.visible = true;
  resetPose();
}

function render(time, frame) {
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

renderer.domElement.addEventListener("pointerup", (event) => {
  if (state.mode !== "ar" && state.placed && hitCharacterFromScreen(event.clientX, event.clientY)) {
    triggerAction();
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(render);
