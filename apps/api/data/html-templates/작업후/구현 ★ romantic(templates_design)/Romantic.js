class FluidReveal {
  constructor() {
    this.frame = document.querySelector('.image-frame');
    this.blob = document.querySelector('.blob');
    this.topImage = document.querySelector('.image-top');
    
    // Mouse tracking
    this.mouse = { x: 0, y: 0 };
    this.current = { x: 0, y: 0 };
    
    // Motion parameters
    this.ease = 0.12; // Smooth trailing
    
    // Blob morphing
    this.time = 0;
    this.morphSpeed = 0.02;
    
    // Canvas for dynamic mask
    this.canvas = document.createElement('canvas');
    this.canvas.width = 280;
    this.canvas.height = 280;
    this.ctx = this.canvas.getContext('2d');
    
    // Current border-radius values
    this.borderRadiusValues = {
      r1: 58, r2: 43, r3: 33, r4: 64,
      r5: 50, r6: 38, r7: 53, r8: 50
    };
    
    // State
    this.isHovering = false;
    this.animationId = null;
    
    this.init();
  }
  
  init() {
    // Event listeners
    this.frame.addEventListener('mouseenter', this.onMouseEnter.bind(this));
    this.frame.addEventListener('mouseleave', this.onMouseLeave.bind(this));
    this.frame.addEventListener('mousemove', this.onMouseMove.bind(this));
    
    // Start animation loop
    this.animate();
  }
  
  onMouseEnter(e) {
    this.isHovering = true;
    this.blob.classList.add('active');
  }
  
  onMouseLeave(e) {
    this.isHovering = false;
    this.blob.classList.remove('active');
  }
  
  onMouseMove(e) {
    const rect = this.frame.getBoundingClientRect();
    
    // Get mouse position relative to frame
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
  }
  
  // Interpolate current position toward mouse with easing
  updatePosition() {
    // Smooth lerp (linear interpolation with easing)
    this.current.x += (this.mouse.x - this.current.x) * this.ease;
    this.current.y += (this.mouse.y - this.current.y) * this.ease;
  }
  
  // Animate heart reveal
  updateBlobMorph() {
    // Static heart shape - no morphing needed
    // Just update the mask
    this.updateMask();
  }
  
  // Draw blob shape on canvas for mask
  updateMask() {
    const w = 280;
    const h = 280;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, w, h);
    
    // Draw organic blob shape
    this.ctx.fillStyle = 'black';
    this.ctx.beginPath();
    
    const centerX = w / 2;
    const centerY = h / 2;
    const baseRadius = w / 3;
    
    // Create blob with organic morphing using sine waves
    for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
      // Multiple sine waves for organic variation
      const variation1 = Math.sin(angle * 3 + this.time) * 15;
      const variation2 = Math.cos(angle * 5 - this.time * 0.7) * 10;
      const variation3 = Math.sin(angle * 7 + this.time * 1.3) * 8;
      
      const radius = baseRadius + variation1 + variation2 + variation3;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      if (angle === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    
    this.ctx.closePath();
    this.ctx.fill();
    
    // Update mask image
    const maskImage = this.canvas.toDataURL();
    document.documentElement.style.setProperty('--mask-image', `url(${maskImage})`);
  }
  
  // Main animation loop
  animate() {
    this.time += this.morphSpeed;
    
    // Update position with easing
    this.updatePosition();
    
    // Apply blob morph animation
    this.updateBlobMorph();
    
    // Position blob
    this.blob.style.left = `${this.current.x}px`;
    this.blob.style.top = `${this.current.y}px`;
    
    // Position mask for top image (140 = half of 280px)
    this.topImage.style.setProperty('--mask-x', `${this.current.x - 140}px`);
    this.topImage.style.setProperty('--mask-y', `${this.current.y - 140}px`);
    
    // Continue loop
    this.animationId = requestAnimationFrame(this.animate.bind(this));
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  new FluidReveal();
});

// ============================================
// SCROLL REVEAL MASK ANIMATION
// ============================================

(function() {
  const scrollRevealSection = document.querySelector('.scroll-reveal-section');
  const scrollCover = document.getElementById('scroll-cover');
  const revealHeadline = document.querySelector('.reveal-headline');
  
  if (!scrollRevealSection || !scrollCover) return;
  
  const totalFrames = 17;
  let sectionStart = 0;
  let sectionHeight = 0;
  
  function updateSectionMetrics() {
    const rect = scrollRevealSection.getBoundingClientRect();
    sectionStart = window.pageYOffset + rect.top;
    sectionHeight = scrollRevealSection.offsetHeight;
  }
  
  function handleScrollReveal() {
    const scrollPos = window.pageYOffset;
    const relativeScroll = scrollPos - sectionStart;
    
    // Only animate when in the scroll reveal section
    if (relativeScroll < 0 || relativeScroll > sectionHeight) {
      if (relativeScroll < 0) {
        // Before section - fully masked
        scrollCover.style.webkitMaskPosition = '0% 50%';
        scrollCover.style.maskPosition = '0% 50%';
        if (revealHeadline) revealHeadline.style.opacity = '1';
      } else {
        // After section - fully revealed
        scrollCover.style.webkitMaskPosition = '100% 50%';
        scrollCover.style.maskPosition = '100% 50%';
        if (revealHeadline) revealHeadline.style.opacity = '0';
      }
      return;
    }
    
    // Calculate progress through the section (0 to 1)
    const progress = relativeScroll / sectionHeight;
    
    // Map progress to frame index (0 to totalFrames - 1)
    const frameIndex = Math.floor(progress * totalFrames);
    const frameProgress = frameIndex / (totalFrames - 1);
    
    // Calculate mask X position (0% to 100%)
    const maskX = frameProgress * 100;
    
    // Update mask position
    scrollCover.style.webkitMaskPosition = `${maskX}% 50%`;
    scrollCover.style.maskPosition = `${maskX}% 50%`;
    
    // Fade out headline as we scroll
    if (revealHeadline) {
      revealHeadline.style.opacity = Math.max(0, 1 - progress * 1.5);
    }
  }
  
  // Wait for page load
  window.addEventListener('load', () => {
    updateSectionMetrics();
    handleScrollReveal();
  });
  
  // Listen for scroll and resize
  window.addEventListener('scroll', handleScrollReveal, { passive: true });
  window.addEventListener('resize', () => {
    updateSectionMetrics();
    handleScrollReveal();
  });
})();

// ============================================
// 3D GLOBE INTERACTION
// ============================================

import * as THREE from "https://esm.sh/three@0.133.1/build/three.module";
import {OrbitControls} from "https://esm.sh/three@0.133.1/examples/jsm/controls/OrbitControls";

const containerEl = document.querySelector(".globe-wrapper");
if (containerEl) {
  const canvas3D = containerEl.querySelector("#globe-3d");
  const canvas2D = containerEl.querySelector("#globe-2d-overlay");
  const popupEl = containerEl.querySelector(".globe-popup");

  let renderer, scene, camera, rayCaster, controls;
  let overlayCtx = canvas2D.getContext("2d");
  let coordinates2D = [0, 0];
  let pointerPos;
  let clock, mouse, pointer, globe, globeMesh;
  let popupVisible;
  let earthTexture, mapMaterial;
  let popupOpenTl, popupCloseTl;

  let dragged = false;

  initScene();
  window.addEventListener("resize", updateSize);


  function initScene() {
      renderer = new THREE.WebGLRenderer({canvas: canvas3D, alpha: true});
      renderer.setPixelRatio(2);
      renderer.setClearColor(0x1a0a0f, 0);

      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x2d0f1a, 1, 3);
      camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0, 3);
      camera.position.z = 1.1;

      rayCaster = new THREE.Raycaster();
      rayCaster.far = 1.15;
      mouse = new THREE.Vector2(-1, -1);
      clock = new THREE.Clock();

      createOrbitControls();

      popupVisible = false;

      new THREE.TextureLoader().load(
          "https://ksenia-k.com/img/earth-map-colored.png",
          (mapTex) => {
              earthTexture = mapTex;
              earthTexture.repeat.set(1, 1);
              createGlobe();
              createPointer();
              createPopupTimelines();
              addCanvasEvents();
              updateSize();
              render();
          });
  }


  function createOrbitControls() {
      controls = new OrbitControls(camera, canvas3D);
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.enableDamping = true;
      controls.minPolarAngle = .4 * Math.PI;
      controls.maxPolarAngle = .4 * Math.PI;
      controls.autoRotate = true;

      let timestamp;
      controls.addEventListener("start", () => {
          timestamp = Date.now();
      });
      controls.addEventListener("end", () => {
          dragged = (Date.now() - timestamp) > 600;
      });
  }

  function createGlobe() {
      const globeGeometry = new THREE.IcosahedronGeometry(1, 22);
      mapMaterial = new THREE.ShaderMaterial({
          vertexShader: document.getElementById("vertex-shader-map").textContent,
          fragmentShader: document.getElementById("fragment-shader-map").textContent,
          uniforms: {
              u_map_tex: {type: "t", value: earthTexture},
              u_dot_size: {type: "f", value: 0},
              u_pointer: {type: "v3", value: new THREE.Vector3(.0, .0, 1.)},
              u_time_since_click: {value: 0},
          },
          alphaTest: false,
          transparent: true
      });

      globe = new THREE.Points(globeGeometry, mapMaterial);
      scene.add(globe);

      globeMesh = new THREE.Mesh(globeGeometry, new THREE.MeshBasicMaterial({
          color: 0x8B002A,
          transparent: true,
          opacity: .15
      }));
      scene.add(globeMesh);
  }

  function createPointer() {
      const geometry = new THREE.SphereGeometry(.04, 16, 16);
      const material = new THREE.MeshBasicMaterial({
          color: 0xFF7291,
          transparent: true,
          opacity: 0
      });
      pointer = new THREE.Mesh(geometry, material);
      scene.add(pointer);
  }


  function updateOverlayGraphic() {
      let activePointPosition = pointer.position.clone();
      activePointPosition.applyMatrix4(globe.matrixWorld);
      const activePointPositionProjected = activePointPosition.clone();
      activePointPositionProjected.project(camera);
      coordinates2D[0] = (activePointPositionProjected.x + 1) * containerEl.offsetWidth * .5;
      coordinates2D[1] = (1 - activePointPositionProjected.y) * containerEl.offsetHeight * .5;

      const matrixWorldInverse = controls.object.matrixWorldInverse;
      activePointPosition.applyMatrix4(matrixWorldInverse);

      if (activePointPosition.z > -1) {
          if (popupVisible === false) {
              popupVisible = true;
              showPopupAnimation(false);
          }

          let popupX = coordinates2D[0];
          popupX -= (activePointPositionProjected.x * containerEl.offsetWidth * .3);

          let popupY = coordinates2D[1];
          const upDown = (activePointPositionProjected.y > .6);
          popupY += (upDown ? 20 : -20);

          gsap.set(popupEl, {
              x: popupX,
              y: popupY,
              xPercent: -35,
              yPercent: upDown ? 0 : -100
          });

          popupY += (upDown ? -5 : 5);
          const curveMidX = popupX + activePointPositionProjected.x * 100;
          const curveMidY = popupY + (upDown ? -.5 : .1) * coordinates2D[1];

          drawPopupConnector(coordinates2D[0], coordinates2D[1], curveMidX, curveMidY, popupX, popupY);

      } else {
          if (popupVisible) {
              popupOpenTl.pause(0);
              popupCloseTl.play(0);
          }
          popupVisible = false;
      }
  }

  function addCanvasEvents() {
      containerEl.addEventListener("mousemove", (e) => {
          updateMousePosition(e.clientX, e.clientY);
      });

      containerEl.addEventListener("click", (e) => {
          if (!dragged) {
              updateMousePosition(
                  e.targetTouches ? e.targetTouches[0].pageX : e.clientX,
                  e.targetTouches ? e.targetTouches[0].pageY : e.clientY,
              );

              const res = checkIntersects();
              if (res.length) {
                  pointerPos = res[0].face.normal.clone();
                  pointer.position.set(res[0].face.normal.x, res[0].face.normal.y, res[0].face.normal.z);
                  mapMaterial.uniforms.u_pointer.value = res[0].face.normal;
                  popupEl.innerHTML = cartesianToLatLong();
                  showPopupAnimation(true);
                  clock.start()
              }
          }
      });

      function updateMousePosition(eX, eY) {
          mouse.x = (eX - containerEl.offsetLeft) / containerEl.offsetWidth * 2 - 1;
          mouse.y = -((eY - containerEl.offsetTop) / containerEl.offsetHeight) * 2 + 1;
      }
  }

  function checkIntersects() {
      rayCaster.setFromCamera(mouse, camera);
      const intersects = rayCaster.intersectObject(globeMesh);
      if (intersects.length) {
          document.body.style.cursor = "pointer";
      } else {
          document.body.style.cursor = "auto";
      }
      return intersects;
  }

  function render() {
      mapMaterial.uniforms.u_time_since_click.value = clock.getElapsedTime();
      checkIntersects();
      if (pointer) {
          updateOverlayGraphic();
      }
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(render);
  }

  function updateSize() {
      const containerWidth = containerEl.offsetWidth;
      const containerHeight = containerEl.offsetHeight;
      renderer.setSize(containerWidth, containerHeight);
      canvas2D.width = containerWidth;
      canvas2D.height = containerHeight;
      mapMaterial.uniforms.u_dot_size.value = .04 * Math.min(containerWidth, containerHeight);
  }


  //  ---------------------------------------
  //  HELPERS

  // popup content
  function cartesianToLatLong() {
      const pos = pointer.position;
      const lat = 90 - Math.acos(pos.y) * 180 / Math.PI;
      const lng = (270 + Math.atan2(pos.x, pos.z) * 180 / Math.PI) % 360 - 180;
      return formatCoordinate(lat, 'N', 'S') + ",&nbsp;" + formatCoordinate(lng, 'E', 'W');
  }

  function formatCoordinate(coordinate, positiveDirection, negativeDirection) {
      const direction = coordinate >= 0 ? positiveDirection : negativeDirection;
      return `${Math.abs(coordinate).toFixed(4)}°&nbsp${direction}`;
  }


  // popup show / hide logic
  function createPopupTimelines() {
      popupOpenTl = gsap.timeline({
          paused: true
      })
          .to(pointer.material, {
              duration: .2,
              opacity: 1,
          }, 0)
          .fromTo(canvas2D, {
              opacity: 0
          }, {
              duration: .3,
              opacity: 1
          }, .15)
          .fromTo(popupEl, {
              opacity: 0,
              scale: .9,
              transformOrigin: "center bottom"
          }, {
              duration: .1,
              opacity: 1,
              scale: 1,
          }, .15 + .1);

      popupCloseTl = gsap.timeline({
          paused: true
      })
          .to(pointer.material, {
              duration: .3,
              opacity: .2,
          }, 0)
          .to(canvas2D, {
              duration: .3,
              opacity: 0
          }, 0)
          .to(popupEl, {
              duration: 0.3,
              opacity: 0,
              scale: 0.9,
              transformOrigin: "center bottom"
          }, 0);
  }

  function showPopupAnimation(lifted) {
      if (lifted) {
          let positionLifted = pointer.position.clone();
          positionLifted.multiplyScalar(1.3);
          gsap.from(pointer.position, {
              duration: .25,
              x: positionLifted.x,
              y: positionLifted.y,
              z: positionLifted.z,
              ease: "power3.out"
          });
      }
      popupCloseTl.pause(0);
      popupOpenTl.play(0);
  }


  // overlay (line between pointer and popup)
  function drawPopupConnector(startX, startY, midX, midY, endX, endY) {
      overlayCtx.strokeStyle = "#ffffff";
      overlayCtx.lineWidth = 2;
      overlayCtx.lineCap = "round";
      overlayCtx.clearRect(0, 0, containerEl.offsetWidth, containerEl.offsetHeight);
      overlayCtx.beginPath();
      overlayCtx.moveTo(startX, startY);
      overlayCtx.quadraticCurveTo(midX, midY, endX, endY);
      overlayCtx.stroke();
  }
}

// ============================================
// SECTION 7: LOVE YOURSELF INTERACTIVE HERO
// ============================================

function playLoveAnimation(img) {
  let tl = gsap.timeline();

  tl.from(
    img,
    {
      scale: 0.8,
      duration: 2
    },
    "<"
  ).to(
    img,
    {
      y: "120vh",
      rotation: "random([360, -360])",
      ease: "back.in(.4)",
      duration: 1,
      filter: "blur(5px)"
    },
    0
  );
}

if (typeof gsap !== 'undefined') {
  let loveImages = gsap.utils.toArray(".love-hero-image");
  let gap = 150;
  let index = 0;
  let wrapper = gsap.utils.wrap(0, loveImages.length);
  gsap.defaults({ duration: 1 });

  let mousePos = { x: 0, y: 0 };
  let lastMousePos = mousePos;
  let cachedMousePos = mousePos;
  let isInSection7 = false;

  // Get section 7 element
  const section7 = document.querySelector('.section-7');

  // Track when mouse enters/leaves section 7
  if (section7) {
    section7.addEventListener("mouseenter", () => {
      isInSection7 = true;
    });

    section7.addEventListener("mouseleave", () => {
      isInSection7 = false;
    });

    section7.addEventListener("mousemove", (e) => {
      mousePos = {
        x: e.clientX,
        y: e.clientY
      };
    });

    section7.addEventListener("touchmove", (e) => {
      if (e.touches.length > 0) {
        mousePos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY
        };
      }
    });
  }

  gsap.ticker.add(ImageTrail);

  function ImageTrail() {
    // Only run if we're in section 7
    if (!isInSection7) return;

    let travelDistance = Math.hypot(
      lastMousePos.x - mousePos.x,
      lastMousePos.y - mousePos.y
    );

    cachedMousePos.x = gsap.utils.interpolate(
      cachedMousePos.x || mousePos.x,
      mousePos.x,
      0.1
    );
    cachedMousePos.y = gsap.utils.interpolate(
      cachedMousePos.y || mousePos.y,
      mousePos.y,
      0.1
    );

    if (travelDistance > gap) {
      animateLoveImage();
      lastMousePos = mousePos;
    }
  }

  function animateLoveImage() {
    let wrappedIndex = wrapper(index);
    let img = loveImages[wrappedIndex];
    
    gsap.killTweensOf(img);

    gsap.set(img, {
      clearProps: "all"
    });

    gsap.set(img, {
      opacity: 1,
      left: mousePos.x,
      top: mousePos.y,
      xPercent: -50,
      yPercent: -50
    });

    playLoveAnimation(img);
    index++;
  }
}