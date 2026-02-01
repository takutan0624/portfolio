// Three.js 近未来的背景
(function() {
    // シーン、カメラ、レンダラーの設定
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('bg-canvas'),
        alpha: true,
        antialias: true
    });

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.position.z = 30;

    // パーティクルシステム
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 1500;
    const posArray = new Float32Array(particlesCount * 3);
    const colorArray = new Float32Array(particlesCount * 3);
    const sizeArray = new Float32Array(particlesCount);

    // パーティクルの位置、色、サイズを設定
    for (let i = 0; i < particlesCount * 3; i += 3) {
        // 位置
        posArray[i] = (Math.random() - 0.5) * 100;
        posArray[i + 1] = (Math.random() - 0.5) * 100;
        posArray[i + 2] = (Math.random() - 0.5) * 100;

        // 色（紫〜青のグラデーション）
        const colorChoice = Math.random();
        if (colorChoice < 0.33) {
            colorArray[i] = 0.4;     // R
            colorArray[i + 1] = 0.5; // G
            colorArray[i + 2] = 0.9; // B
        } else if (colorChoice < 0.66) {
            colorArray[i] = 0.46;
            colorArray[i + 1] = 0.27;
            colorArray[i + 2] = 0.64;
        } else {
            colorArray[i] = 0.94;
            colorArray[i + 1] = 0.58;
            colorArray[i + 2] = 0.98;
        }

        // サイズ
        sizeArray[i / 3] = Math.random() * 2 + 0.5;
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    particlesGeometry.setAttribute('size', new THREE.BufferAttribute(sizeArray, 1));

    // パーティクルマテリアル
    const particlesMaterial = new THREE.PointsMaterial({
        size: 0.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });

    const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);

    // 波状のメッシュ
    const waveGeometry = new THREE.PlaneGeometry(80, 80, 50, 50);
    const waveMaterial = new THREE.MeshBasicMaterial({
        color: 0x667eea,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending
    });
    const waveMesh = new THREE.Mesh(waveGeometry, waveMaterial);
    waveMesh.rotation.x = -Math.PI * 0.35;
    waveMesh.position.z = -20;
    scene.add(waveMesh);

    // 第2の波
    const wave2Geometry = new THREE.PlaneGeometry(80, 80, 50, 50);
    const wave2Material = new THREE.MeshBasicMaterial({
        color: 0x764ba2,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending
    });
    const wave2Mesh = new THREE.Mesh(wave2Geometry, wave2Material);
    wave2Mesh.rotation.x = -Math.PI * 0.35;
    wave2Mesh.position.z = -25;
    wave2Mesh.position.y = -5;
    scene.add(wave2Mesh);

    // リング
    const ringGeometry = new THREE.TorusGeometry(15, 0.3, 16, 100);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xf093fb,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.z = -30;
    ring.rotation.x = Math.PI * 0.5;
    scene.add(ring);

    // マウス追従
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    document.addEventListener('mousemove', (event) => {
        mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    });

    // アニメーションループ
    let time = 0;
    function animate() {
        requestAnimationFrame(animate);
        time += 0.01;

        // パーティクルの回転とアニメーション
        particlesMesh.rotation.y = time * 0.05;
        particlesMesh.rotation.x = Math.sin(time * 0.3) * 0.1;

        // パーティクルの上下動
        const positions = particlesMesh.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
            positions[i] = Math.sin(time + positions[i]) * 0.5 + positions[i];
        }
        particlesMesh.geometry.attributes.position.needsUpdate = true;

        // 波のアニメーション
        const wavePositions = waveMesh.geometry.attributes.position.array;
        for (let i = 0; i < wavePositions.length; i += 3) {
            const x = wavePositions[i];
            const y = wavePositions[i + 1];
            wavePositions[i + 2] = Math.sin(x * 0.2 + time) * 2 + Math.cos(y * 0.2 + time) * 2;
        }
        waveMesh.geometry.attributes.position.needsUpdate = true;

        // 第2の波
        const wave2Positions = wave2Mesh.geometry.attributes.position.array;
        for (let i = 0; i < wave2Positions.length; i += 3) {
            const x = wave2Positions[i];
            const y = wave2Positions[i + 1];
            wave2Positions[i + 2] = Math.sin(x * 0.15 + time * 0.8) * 2.5 + Math.cos(y * 0.15 + time * 0.8) * 2.5;
        }
        wave2Mesh.geometry.attributes.position.needsUpdate = true;

        // リングの回転
        ring.rotation.z = time * 0.2;

        // マウス追従（スムーズに）
        targetX += (mouseX - targetX) * 0.05;
        targetY += (mouseY - targetY) * 0.05;

        camera.position.x = targetX * 2;
        camera.position.y = targetY * 2;
        camera.lookAt(scene.position);

        renderer.render(scene, camera);
    }

    // リサイズ対応
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });

    // アニメーション開始
    animate();

    // モバイルでのパフォーマンス最適化
    if (window.innerWidth < 768) {
        // モバイルではパーティクル数を減らす
        particlesMaterial.size = 0.3;
        particlesMaterial.opacity = 0.6;
    }
})();
