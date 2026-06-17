'use strict';

/* Globe "war room" en three.js (chargé via CDN, global THREE).
 * Dégrade proprement si three.js n'est pas disponible. */
window.Globe = (function () {
  const COL = { russia: 0xff4d4d, ukraine: 0x4d8bff };
  const R = 1.6;
  // points representatifs (lat,lng)
  const POS = { russia: { lat: 57, lng: 65 }, ukraine: { lat: 49, lng: 31 } };

  let renderer, scene, camera, globeGroup, soldierGroup, markers = {}, anims = [], raf = 0, lastT = 0, soldiersKey = '';
  let ok = false;

  function latLng(lat, lng, r) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }

  function radialSprite(color, size) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const col = '#' + new THREE.Color(color).getHexString();
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, col); grd.addColorStop(0.25, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    m.scale.set(size, size, 1);
    return m;
  }

  function textSprite(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '700 34px Rajdhani, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 128, 34);
    g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillText(text, 128, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
    s.scale.set(1.1, 0.28, 1);
    return s;
  }

  function graticule() {
    const pts = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lng = 0; lng < 360; lng += 6) {
        pts.push(latLng(lat, lng, R * 1.003), latLng(lat, lng + 6, R * 1.003));
      }
    }
    for (let lng = 0; lng < 360; lng += 30) {
      for (let lat = -84; lat < 84; lat += 6) {
        pts.push(latLng(lat, lng, R * 1.003), latLng(lat + 6, lng, R * 1.003));
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2f8f8a, transparent: true, opacity: 0.25 }));
  }

  function init(el) {
    if (typeof THREE === 'undefined' || !el) return false;
    try {
      const w = el.clientWidth || 600, h = el.clientHeight || 340;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w, h);
      el.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(0, 0.6, 5);

      scene.add(new THREE.AmbientLight(0x88aacc, 0.5));
      const pl = new THREE.PointLight(0xffffff, 1.1); pl.position.set(5, 3, 5); scene.add(pl);

      globeGroup = new THREE.Group(); scene.add(globeGroup);

      // sphere
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(R, 48, 48),
        new THREE.MeshPhongMaterial({ color: 0x0c2233, emissive: 0x06121d, shininess: 18, specular: 0x224455 })
      );
      globeGroup.add(sphere);
      globeGroup.add(graticule());

      // halo atmosphere
      const halo = radialSprite(0x2f6fae, 5.2); halo.position.set(0, 0, 0); scene.add(halo);

      // marqueurs
      for (const k of ['russia', 'ukraine']) {
        const base = latLng(POS[k].lat, POS[k].lng, R);
        const grp = new THREE.Group();
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), new THREE.MeshBasicMaterial({ color: COL[k] }));
        dot.position.copy(base);
        const glow = radialSprite(COL[k], 0.6); glow.position.copy(base.clone().multiplyScalar(1.01));
        const label = textSprite(k === 'russia' ? 'GOUGOULE' : 'YAYA', COL[k]);
        label.position.copy(base.clone().multiplyScalar(1.25));
        grp.add(dot); grp.add(glow); grp.add(label);
        globeGroup.add(grp);
        markers[k] = { base, glow, dot, pulse: 0 };
      }
      soldierGroup = new THREE.Group(); globeGroup.add(soldierGroup);

      // caméra fixe, centrée et zoomée sur la région des deux pays (pas de rotation)
      const center = latLng(53, 45, 1).normalize();
      camera.position.copy(center.clone().multiplyScalar(3.55));
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);

      ok = true;
      window.addEventListener('resize', onResize);
      lastT = performance.now();
      loop();
      return true;
    } catch (e) { console.warn('Globe indisponible:', e); ok = false; return false; }
  }

  function onResize() {
    if (!ok) return;
    const el = renderer.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function setControl(share) {
    if (!ok) return;
    const rs = 0.35 + (share / 100) * 0.9;        // taille glow russie selon territoire
    const us = 0.35 + ((100 - share) / 100) * 0.9;
    markers.russia.glow.scale.set(rs, rs, 1);
    markers.ukraine.glow.scale.set(us, us, 1);
  }

  function addBomb(from) {
    if (!ok) return;
    const to = from === 'russia' ? 'ukraine' : 'russia';
    const start = markers[from].base.clone();
    const end = markers[to].base.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(R * 1.9);
    const curve = new THREE.QuadraticBezierCurve3(start.clone().multiplyScalar(1.02), mid, end.clone().multiplyScalar(1.02));

    // trainee
    const trailGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: COL[from], transparent: true, opacity: 0.8 }));
    globeGroup.add(trail);

    // missile
    const missile = radialSprite(0xffd9a0, 0.28); globeGroup.add(missile);

    anims.push({ type: 'missile', curve, missile, trail, to, t: 0, dur: 1.1 });
    markers[to].pulse = 1;
  }

  function explode(pos, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.02, 0.06, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.copy(pos.clone().multiplyScalar(1.02));
    ring.lookAt(pos.clone().multiplyScalar(3));
    globeGroup.add(ring);
    const flash = radialSprite(0xffe3a0, 0.9); flash.position.copy(pos.clone().multiplyScalar(1.03)); globeGroup.add(flash);
    anims.push({ type: 'boom', ring, flash, t: 0, dur: 0.9 });
  }

  function avatarSprite(initial, color) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#0b1018'; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 34px Rajdhani, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initial, 32, 36);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
  }

  function loadAvatar(url, sprite, color) {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 72; const g = c.getContext('2d');
        g.save(); g.beginPath(); g.arc(36, 36, 34, 0, Math.PI * 2); g.clip(); g.drawImage(img, 0, 0, 72, 72); g.restore();
        g.beginPath(); g.arc(36, 36, 34, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = '#' + new THREE.Color(color).getHexString(); g.stroke();
        sprite.material.map = new THREE.CanvasTexture(c); sprite.material.needsUpdate = true;
      } catch (e) {}
    };
    img.src = url;
  }

  function setSoldiers(russia, ukraine) {
    if (!ok || !soldierGroup) return;
    const k = (l) => (l || []).map((s) => s.name + (s.avatar ? '#' : '')).join(',');
    const key = k(russia) + '|' + k(ukraine);
    if (key === soldiersKey) return; soldiersKey = key;
    while (soldierGroup.children.length) soldierGroup.remove(soldierGroup.children[0]);
    const place = (list, side) => {
      const m = POS[side];
      (list || []).slice(0, 8).forEach((s, i) => {
        const ang = (i / 8) * Math.PI * 2;
        const p = latLng(m.lat + Math.cos(ang) * 9, m.lng + Math.sin(ang) * 12, R * 1.05);
        const sp = avatarSprite((s.name[0] || '?').toUpperCase(), COL[side]);
        sp.position.copy(p); sp.scale.set(0.24, 0.24, 1);
        soldierGroup.add(sp);
        if (s.avatar) loadAvatar(s.avatar, sp, COL[side]);
      });
    };
    place(russia, 'russia'); place(ukraine, 'ukraine');
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;

    for (const k in markers) {
      const m = markers[k];
      const base = 0.5 + 0.12 * Math.sin(now * 0.004);
      const s = (parseFloat(m.glow.scale.x) || 0.6);
      m.glow.material.opacity = base + m.pulse * 0.5;
      if (m.pulse > 0) m.pulse = Math.max(0, m.pulse - dt * 1.5);
    }

    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt / a.dur;
      if (a.type === 'missile') {
        const p = a.curve.getPoint(Math.min(1, a.t));
        a.missile.position.copy(p);
        a.trail.material.opacity = 0.8 * (1 - a.t * 0.4);
        if (a.t >= 1) {
          explode(markers[a.to].base, COL[a.to === 'russia' ? 'ukraine' : 'russia']);
          globeGroup.remove(a.missile); globeGroup.remove(a.trail);
          anims.splice(i, 1);
        }
      } else if (a.type === 'boom') {
        const s = 1 + a.t * 7;
        a.ring.scale.set(s, s, s);
        a.ring.material.opacity = 0.9 * (1 - a.t);
        a.flash.material.opacity = Math.max(0, 0.9 * (1 - a.t * 1.6));
        if (a.t >= 1) { globeGroup.remove(a.ring); globeGroup.remove(a.flash); anims.splice(i, 1); }
      }
    }
    renderer.render(scene, camera);
  }

  return { init, setControl, addBomb, setSoldiers, get available() { return ok; } };
})();
