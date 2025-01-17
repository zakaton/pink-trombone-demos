const vectorOffset = new THREE.Vector3();
const eulerOffset = new THREE.Euler();
const cameraEuler = new THREE.Euler();
let vectorScalar = 0.02;
let eulerScalar = 0.02;
const { send } = setupConnection("game", (message) => {
  let { results, loudness } = message;
  loudness = loudness || 0.1;
  vectorOffset.set(0, 0, 0);
  eulerOffset.set(0, 0, 0);

  results = [results[0]];

  results.forEach(({ name, weight }) => {
    console.log({ name, weight });
    switch (name) {
      case "forward":
      case "w":
        vectorOffset.z = -weight;
        break;
      case "backward":
      case "ɔ":
        vectorOffset.z = weight;
        break;
      case "left":
      case "l":
        eulerOffset.y = weight;
        break;
      case "right":
      case "r":
        eulerOffset.y = -weight;
        break;
      case "up":
      case "i":
        eulerOffset.x = weight;
        break;
      case "down":
      case "e":
      case "ɪ":
        eulerOffset.x = -weight;
        break;
    }
  });

  const loudnessScalar = THREE.MathUtils.inverseLerp(0.01, 0.03, loudness);

  eulerOffset.x *= loudnessScalar * eulerScalar;
  eulerOffset.y *= loudnessScalar * eulerScalar;

  camera.object3D.rotation.x += eulerOffset.x;
  camera.object3D.rotation.y += eulerOffset.y;

  vectorOffset.multiplyScalar(loudnessScalar * vectorScalar);

  cameraEuler.copy(camera.object3D.rotation);
  cameraEuler.x = cameraEuler.z = 0;
  vectorOffset.applyEuler(cameraEuler);
  camera.object3D.position.add(vectorOffset);
});

let camera;
const scene = document.querySelector("a-scene");
scene.addEventListener("loaded", (event) => {
  camera = document.querySelector("a-camera");
});
