import React, { Component } from "react";
import PropTypes from "prop-types";
import "three/examples/js/controls/OrbitControls";

import { createDefaultEnvironmentMap } from "../components/environment-map";
import { loadGLTF } from "../components/gltf-model-plus";
import { disposeNode } from "../utils/three-utils";

const TEXTURE_PROPS = {
  base_map: ["map"],
  emissive_map: ["emissiveMap"],
  normal_map: ["normalMap"],
  orm_map: ["aoMap", "roughnessMap", "metalnessMap"]
};

const ALL_MAPS = Object.keys(TEXTURE_PROPS);

const DEFAULT_ORBIT_ANGLE = new THREE.Euler(-20 * THREE.Math.DEG2RAD, 30 * THREE.Math.DEG2RAD, 0);

function fitBoxInFrustum(camera, box, center, orbitAngle = DEFAULT_ORBIT_ANGLE) {
  const halfYExtents = (box.max.y - box.min.y) / 2;
  const halfVertFOV = THREE.Math.degToRad(camera.fov / 2);
  camera.position.set(0, 0, halfYExtents / Math.tan(halfVertFOV));
  camera.position.applyEuler(orbitAngle);
  camera.position.add(center);
  camera.matrixAutoUpdate = true;
  camera.lookAt(center);
}

// This should match our aframe renderer="antialias: true; colorManagement: true; sortObjects: true; physicallyCorrectLights: true; alpha: false; webgl2: true; multiview: false;"
function createRenderer(canvas) {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    depth: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "default"
  });

  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.gammaOutput = true;
  renderer.gammaFactor = 2.2;
  renderer.physicallyCorrectLights = true;
  return renderer;
}

const createImageBitmapFromURL = url =>
  fetch(url)
    .then(r => r.blob())
    .then(createImageBitmap);

export default class AvatarPreview extends Component {
  static propTypes = {
    avatar: PropTypes.object
  };
  constructor(props) {
    super(props);
    this.state = {
      loading: true
    };
    this.imageBitmaps = {};
  }

  componentDidMount = () => {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 1000);
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);

    const light = new THREE.DirectionalLight(0xfdf5c2, 3);
    light.position.set(0, 10, 10);
    this.scene.add(light);
    this.scene.add(new THREE.HemisphereLight(0xb1e3ff, 0xb1e3ff, 3));

    this.camera.position.set(-0.2, 0.5, 0.5);
    this.camera.matrixAutoUpdate = true;

    this.controls.target.set(0, 0.45, 0);
    this.controls.update();

    this.loadPreviewAvatar(this.props.avatar && this.props.avatar.base_gltf_url).then(this.setAvatar);

    const clock = new THREE.Clock();

    this.snapshotCanvas = document.createElement("canvas");
    this.snapshotCanvas.width = 720;
    this.snapshotCanvas.height = 1280;
    // this.snapshotCanvas.style.zIndex = 1000;
    // this.snapshotCanvas.style.position = "absolute";
    // this.snapshotCanvas.style.top = 0;
    // this.snapshotCanvas.style.width = "200px";
    // this.snapshotCanvas.style.background = "grey";
    // document.body.appendChild(this.snapshotCanvas);

    this.snapshotCamera = new THREE.PerspectiveCamera(
      55,
      this.snapshotCanvas.width / this.snapshotCanvas.height,
      0.1,
      1000
    );

    this.snapshotRenderer = createRenderer(this.snapshotCanvas);
    this.snapshotRenderer.setClearAlpha(0);

    this.previewRenderer = createRenderer(this.canvas);
    this.previewRenderer.setClearColor(new THREE.Color(0xeaeaea));
    this.previewRenderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      this.mixer && this.mixer.update(dt);
      this.previewRenderer.render(this.scene, this.camera);
      // this.snapshotRenderer.render(this.scene, this.snapshotCamera);
    });
    window.addEventListener("resize", () => {
      this.resize();
    });
    // this.resizeInterval = setInterval(
    //   (() => {
    //     let width = this.canvas.parentElement.offsetWidth;
    //     let height = this.canvas.parentElement.offsetHeight;
    //     return () => {
    //       const newWidth = this.canvas.parentElement.offsetWidth;
    //       const newHeight = this.canvas.parentElement.offsetHeight;
    //       if (newWidth !== width || newHeight !== height) {
    //         width = newWidth;
    //         height = newHeight;
    //         this.resize();
    //       }
    //     };
    //   })(),
    //   100
    // );
    this.resize();
  };

  setAvatar = avatar => {
    if (!avatar) return;
    this.avatar = avatar;
    this.scene.add(avatar);
    this.resetCamera();
    this.setState({ loading: false });
  };

  resetCamera = (() => {
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    return () => {
      box.setFromObject(this.avatar);
      center.set((box.min.x + box.max.x) * 0.5, (box.min.y + box.max.y) * 0.6, (box.min.z + box.max.z) * 0.5);
      fitBoxInFrustum(this.camera, box, center);
      fitBoxInFrustum(this.snapshotCamera, box, center);
      this.controls.target.copy(center);
      this.controls.update();
    };
  })();

  resize = () => {
    const width = this.canvas.parentElement.offsetWidth;
    const height = this.canvas.parentElement.offsetHeight;
    this.previewRenderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  componentWillUnmount = () => {
    this.scene && this.scene.traverse(disposeNode);
    this.previewRenderer && this.previewRenderer.dispose();
    this.controls.dispose();
    Object.values(this.imageBitmaps).forEach(img => img.close());
    window.removeEventListener("resize", this.resize);
    // clearInterval(this.resizeInterval);
    // this.snapshotCanvas.parentNode.removeChild(this.snapshotCanvas);
  };

  componentDidUpdate = async oldProps => {
    if (oldProps.avatar && this.props.avatar && oldProps.avatar.base_gltf_url !== this.props.avatar.base_gltf_url) {
      if (this.avatar) {
        this.scene.remove(this.avatar);
        this.avatar = null;
      }
      await this.loadPreviewAvatar(this.props.avatar.base_gltf_url).then(this.setAvatar);
    }

    this.applyMaps(oldProps, this.props);
  };

  applyMaps(oldProps, newProps) {
    return Promise.all(
      ALL_MAPS.map(mapName => {
        const applyMap = this.applyMapToPreview.bind(this, mapName);
        if (oldProps[mapName] != newProps[mapName]) {
          if (newProps[mapName] instanceof File) {
            return createImageBitmap(newProps[mapName]).then(applyMap);
          } else if (newProps[mapName]) {
            return createImageBitmapFromURL(newProps[mapName]).then(applyMap);
          } else {
            return this.revertMap(mapName);
          }
        }
      })
    );
  }

  loadPreviewAvatar = async url => {
    if (!url) return;
    const gltf = await loadGLTF(url, "model/gltf");

    // On the bckend we look for a material called Bot_PBS, here we are looking for a mesh called Avatar.
    // When we "officially" support uploading custom GLTFs we need to decide what we are going to key things on
    this.previewMesh =
      gltf.scene.getObjectByName("AvatarMesh") ||
      gltf.scene.getObjectByName("Avatar") ||
      gltf.scene.getObjectByName("Bot_Skinned");

    const idleAnimation = gltf.animations && gltf.animations.find(({ name }) => name === "idle_eyes");
    if (idleAnimation) {
      this.mixer = new THREE.AnimationMixer(this.previewMesh);
      const action = this.mixer.clipAction(idleAnimation);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity).play();
      this.idleAnimationAction = action;
    }

    const material = this.previewMesh.material;
    // We delete onUpdate here to opt out of the auto texture cleanup after GPU upload.
    const getImage = p => delete material[p].onUpdate && material[p].image;
    this.originalMaps = {
      base_map: TEXTURE_PROPS["base_map"].map(getImage),
      emissive_map: TEXTURE_PROPS["emissive_map"].map(getImage),
      normal_map: TEXTURE_PROPS["normal_map"].map(getImage),
      orm_map: TEXTURE_PROPS["orm_map"].map(getImage)
    };

    await Promise.all([
      this.applyMaps({}, this.props), // Apply initial maps
      createDefaultEnvironmentMap().then(t => {
        this.previewMesh.material.envMap = t;
        this.previewMesh.material.needsUpdate = true;
      })
    ]);

    return gltf.scene;
  };

  applyMapToPreview = (name, image) => {
    if (this.imageBitmaps[name]) {
      this.imageBitmaps[name].close();
    }
    this.imageBitmaps[name] = image;
    TEXTURE_PROPS[name].forEach(prop => {
      const texture = this.previewMesh.material[prop];
      texture.image = image;
      texture.needsUpdate = true;
    });
  };

  revertMap = name => {
    if (this.imageBitmaps[name]) {
      this.imageBitmaps[name].close();
    }
    delete this.imageBitmaps[name];
    this.originalMaps[name].forEach((bm, i) => {
      const texture = this.previewMesh.material[TEXTURE_PROPS[name][i]];
      texture.image = bm;
      texture.needsUpdate = true;
    });
  };

  snapshot = () => {
    return new Promise(resolve => {
      this.idleAnimationAction && this.idleAnimationAction.reset();
      this.snapshotRenderer.render(this.scene, this.snapshotCamera);
      this.snapshotCanvas.toBlob(resolve);
    });
  };

  render() {
    return (
      <div className="preview">
        {this.state.loading && (
          <div className="loader">
            <div className="loader-center" />
          </div>
        )}
        <canvas ref={c => (this.canvas = c)} />
      </div>
    );
  }
}
