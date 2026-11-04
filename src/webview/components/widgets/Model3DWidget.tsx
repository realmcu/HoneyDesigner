import React, { useEffect, useRef, useState } from 'react';
import { WidgetProps } from './types';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { useWebviewUri } from '../../hooks/useWebviewUri';
import { t } from '../../i18n';

export const Model3DWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // 交互动画状态
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const rotationAngleRef = useRef({ x: 0, y: 0, z: 0 });
  
  const modelPath = component.data?.modelPath as string;
  
  // 自动查找同名MTL文件（将 .obj 替换为 .mtl）
  const autoMtlPath = modelPath && modelPath.toLowerCase().endsWith('.obj')
    ? modelPath.replace(/\.obj$/i, '.mtl')
    : undefined;
  
  // 转换为 webview URI
  const modelUri = useWebviewUri(modelPath);
  const mtlUri = useWebviewUri(autoMtlPath);
  
  const worldX = (component.data?.worldX as number) ?? 0;
  const worldY = (component.data?.worldY as number) ?? 0;
  const worldZ = (component.data?.worldZ as number) ?? 30;
  const rotationX = ((component.data?.rotationX as number) ?? 0) * Math.PI / 180;
  const rotationY = ((component.data?.rotationY as number) ?? 0) * Math.PI / 180;
  const rotationZ = ((component.data?.rotationZ as number) ?? 0) * Math.PI / 180;
  const scale = (component.data?.scale as number) ?? 5;
  const cameraPosX = (component.data?.cameraPosX as number) ?? 0;
  const cameraPosY = (component.data?.cameraPosY as number) ?? 0;
  const cameraPosZ = (component.data?.cameraPosZ as number) ?? 0;
  const cameraLookX = (component.data?.cameraLookX as number) ?? 0;
  const cameraLookY = (component.data?.cameraLookY as number) ?? 0;
  const cameraLookZ = (component.data?.cameraLookZ as number) ?? 1;
  const cameraFov = 90; // 固定90度，与GUI引擎一致
  
  // 交互动画配置
  const touchRotationEnabled = component.data?.touchRotationEnabled as boolean ?? false;
  const touchRotationAxis = (component.data?.touchRotationAxis as string) ?? 'y';
  const touchRotationSensitivity = (component.data?.touchRotationSensitivity as number) ?? 5.0;
  const autoRotationEnabled = component.data?.autoRotationEnabled as boolean ?? false;
  const autoRotationAxis = (component.data?.autoRotationAxis as string) ?? 'y';
  const autoRotationSpeed = (component.data?.autoRotationSpeed as number) ?? 1.0; // 角度/帧

  // 当动画被禁用时，重置旋转角度
  useEffect(() => {
    if (!touchRotationEnabled && !autoRotationEnabled) {
      rotationAngleRef.current = { x: 0, y: 0, z: 0 };
    }
  }, [touchRotationEnabled, autoRotationEnabled]);

  // 监听宽高变化，更新渲染器和相机
  useEffect(() => {
    if (!containerRef.current) return;
    
    const width = component.position.width;
    const height = component.position.height;
    
    if (rendererRef.current && cameraRef.current) {
      rendererRef.current.setSize(width, height);
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [component.position.width, component.position.height]);

  useEffect(() => {
    if (!containerRef.current || !modelUri) return;

    setIsLoading(true);
    setLoadError(null);

    // 初始化场景
    const scene = new THREE.Scene();
    // 透明背景，融入设计窗口
    scene.background = null;
    sceneRef.current = scene;

    // 初始化相机
    const width = component.position.width;
    const height = component.position.height;
    const camera = new THREE.PerspectiveCamera(cameraFov, width / height, 1, 32767);

    camera.position.set(cameraPosX, -cameraPosY, -cameraPosZ);
    camera.lookAt(cameraLookX, -cameraLookY, -cameraLookZ);
    cameraRef.current = camera;

    // 初始化渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    // 启用透明度排序
    renderer.sortObjects = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;



    // 添加光源（适应新坐标系）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    // 主光源从前上方照射
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(5, -5, -5); // Y向下，Z向里
    scene.add(directionalLight1);
    
    // 补光从后下方
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-5, 5, 5);
    scene.add(directionalLight2);

    // 加载模型
    const ext = modelPath?.split('.').pop()?.toLowerCase();
    
    const onLoadSuccess = (model: THREE.Object3D, modelType: 'obj' | 'gltf' | 'glb') => {
      // 先更新骨骼（如果有）到初始姿态
      model.traverse((child: any) => {
        if (child.isSkinnedMesh && child.skeleton) {
          // 确保骨骼在初始状态
          child.skeleton.pose();
        }
      });
      
      // 直接应用用户设置的缩放值
      model.scale.set(scale, scale, scale);
      
      // 坐标系转换：X轴旋转180度，实现 Y上→Y下，Z外→Z里
      model.rotation.x = Math.PI;
      
      // 应用用户旋转（叠加在坐标系转换之上）
      model.rotation.x += rotationX;
      model.rotation.y += rotationY;
      model.rotation.z += rotationZ;
      
      model.position.set(worldX, -worldY, -worldZ);
      
      scene.add(model);
      modelRef.current = model;
      
      setIsLoading(false);
    };
    
    const onLoadError = (error: any) => {
      console.warn('[3D模型] 加载失败:', error?.message || error);
      setLoadError(t('3D model load failed: {0}', error?.message || t('Unknown error')));
      setIsLoading(false);
    };
    
    if (ext === 'gltf' || ext === 'glb') {
      const loader = new GLTFLoader();
      
      // GLTF 文件可能引用外部资源，需要设置基础路径
      const gltfPath = modelUri.substring(0, modelUri.lastIndexOf('/') + 1);
      const gltfFileName = modelUri.substring(modelUri.lastIndexOf('/') + 1);
      
      loader.setPath(gltfPath);
      loader.load(
        gltfFileName,
        (gltf: any) => {
          // GLTF场景可能包含多层嵌套，需要规范化
          const model = gltf.scene;
          
          // 遍历场景图，确保材质正确设置
          model.traverse((child: any) => {
            if (child.isMesh && child.material) {
              // 确保双面渲染
              if (Array.isArray(child.material)) {
                child.material.forEach((mat: any) => {
                  mat.side = THREE.DoubleSide;
                  // 禁用透明度（除非明确需要）
                  if (mat.transparent && mat.opacity >= 0.99) {
                    mat.transparent = false;
                    mat.alphaTest = 0;
                  }
                  // 确保深度写入
                  mat.depthWrite = true;
                  mat.depthTest = true;
                  mat.needsUpdate = true;
                });
              } else {
                child.material.side = THREE.DoubleSide;
                // 禁用透明度（除非明确需要）
                if (child.material.transparent && child.material.opacity >= 0.99) {
                  child.material.transparent = false;
                  child.material.alphaTest = 0;
                }
                // 确保深度写入
                child.material.depthWrite = true;
                child.material.depthTest = true;
                child.material.needsUpdate = true;
              }
              // 确保 mesh 可见
              child.visible = true;
              child.frustumCulled = false; // 禁用视锥体剔除，确保显示
            }
          });
          
          onLoadSuccess(model, ext === 'glb' ? 'glb' : 'gltf');
        },
        undefined,
        onLoadError
      );
    } else if (ext === 'obj') {
      
      // 先读取 OBJ 文件，检查是否引用了 MTL 文件
      fetch(modelUri)
        .then(response => response.text())
        .then(objContent => {
          // 检查 OBJ 文件中是否有 mtllib 声明
          const mtllibMatch = objContent.match(/^mtllib\s+(.+)$/m);
          const hasMtllib = !!mtllibMatch;
          
          if (hasMtllib && mtlUri && (mtlUri.startsWith('http') || mtlUri.startsWith('vscode-webview'))) {
            // OBJ 文件声明了 MTL，尝试加载
            const mtlLoader = new MTLLoader();
            const texturePath = mtlUri.substring(0, mtlUri.lastIndexOf('/') + 1);
            const mtlFileName = mtlUri.substring(mtlUri.lastIndexOf('/') + 1);
            
            mtlLoader.setPath(texturePath);
            
            mtlLoader.load(
              mtlFileName,
              (materials: any) => {
                materials.preload();
                
                // 修复材质
                Object.keys(materials.materials).forEach((key) => {
                  const mat = materials.materials[key];
                  mat.side = THREE.DoubleSide;
                  mat.flatShading = false;
                  
                  if (mat.opacity < 1.0 || mat.transparent) {
                    mat.transparent = true;
                    mat.alphaTest = 0.5;
                  }
                  
                  if (mat.map) {
                    mat.map.needsUpdate = true;
                    mat.map.minFilter = THREE.LinearFilter;
                    mat.map.magFilter = THREE.LinearFilter;
                    mat.map.anisotropy = 16;
                    
                    if (mat.map.format === THREE.RGBAFormat) {
                      mat.transparent = true;
                      mat.alphaTest = 0.5;
                    }
                  }
                  
                  mat.needsUpdate = true;
                });
                
                // 使用材质加载 OBJ
                const objLoader = new OBJLoader();
                const objPath = modelUri.substring(0, modelUri.lastIndexOf('/') + 1);
                const objFileName = modelUri.substring(modelUri.lastIndexOf('/') + 1);
                
                objLoader.setPath(objPath);
                objLoader.setMaterials(materials);
                objLoader.load(
                  objFileName,
                  (obj: any) => {
                    // 确保材质正确应用
                    obj.traverse((child: any) => {
                      if (child.isMesh && child.material) {
                        if (Array.isArray(child.material)) {
                          child.material.forEach((mat: any) => {
                            if (mat.type === 'MeshPhongMaterial') {
                              mat.side = THREE.DoubleSide;
                              mat.needsUpdate = true;
                            }
                          });
                        } else if (child.material.type === 'MeshPhongMaterial') {
                          child.material.side = THREE.DoubleSide;
                          child.material.needsUpdate = true;
                        }
                      }
                    });
                    onLoadSuccess(obj, 'obj');
                  },
                  undefined,
                  onLoadError
                );
              },
              undefined,
              (error: any) => {
                // MTL 加载失败，但 OBJ 声明了需要它，报告错误
                console.error('[3D模型] MTL 文件加载失败:', error);
                onLoadError(error);
              }
            );
          } else {
            // OBJ 文件没有声明 MTL，直接使用默认材质加载
            const objLoader = new OBJLoader();
            const objPath = modelUri.substring(0, modelUri.lastIndexOf('/') + 1);
            const objFileName = modelUri.substring(modelUri.lastIndexOf('/') + 1);
            objLoader.setPath(objPath);
            objLoader.load(
              objFileName,
              (obj: any) => {
                obj.traverse((child: any) => {
                  if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                      color: 0xcccccc,
                      side: THREE.DoubleSide
                    });
                  }
                });
                onLoadSuccess(obj, 'obj');
              },
              undefined,
              onLoadError
            );
          }
        })
        .catch((error) => {
          console.error('[3D模型] OBJ 文件读取失败:', error);
          onLoadError(error);
        });
    } else {
      setLoadError(t('Unsupported file format: {0}', ext || 'unknown'));
      setIsLoading(false);
    }

    // 动画循环
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      
      // 自动旋转动画（角度制，正值逆时针，Three.js 需要取反）
      if (autoRotationEnabled && modelRef.current) {
        const speedInRadians = (autoRotationSpeed * Math.PI) / 180; // 转换为弧度
        if (autoRotationAxis === 'x') {
          rotationAngleRef.current.x -= speedInRadians; // 取反以匹配设备旋转方向
        } else if (autoRotationAxis === 'y') {
          rotationAngleRef.current.y -= speedInRadians; // 取反以匹配设备旋转方向
        } else if (autoRotationAxis === 'z') {
          rotationAngleRef.current.z -= speedInRadians; // 取反以匹配设备旋转方向
        }
      }
      
      // 应用旋转（叠加在初始旋转之上）
      if (modelRef.current) {
        modelRef.current.rotation.x = Math.PI + rotationX + rotationAngleRef.current.x;
        modelRef.current.rotation.y = rotationY + rotationAngleRef.current.y;
        modelRef.current.rotation.z = rotationZ + rotationAngleRef.current.z;
      }
      
      // 更新骨骼动画（如果有）
      if (modelRef.current) {
        modelRef.current.traverse((child: any) => {
          if (child.isSkinnedMesh && child.skeleton) {
            child.skeleton.update();
          }
        });
      }
      
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // 清理
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (rendererRef.current && containerRef.current) {
        if (containerRef.current.contains(rendererRef.current.domElement)) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
      }
      if (sceneRef.current) {
        sceneRef.current.clear();
      }
    };
  }, [modelUri, mtlUri, worldX, worldY, worldZ, rotationX, rotationY, rotationZ, scale, cameraPosX, cameraPosY, cameraPosZ, cameraLookX, cameraLookY, cameraLookZ, autoRotationEnabled, autoRotationAxis, autoRotationSpeed]);

  // 触摸旋转交互
  // 未使用 {...handlers} 展开：onMouseDown/onMouseUp 要叠加 3D 旋转逻辑，
  // 因此这里手动复刻 handlers 里的 data-component-id，保证画布命中测试能找到本控件。
  const handleMouseDown = (e: React.MouseEvent) => {
    handlers.onMouseDown(e);
    // 只响应鼠标中键（滚轮按下）
    if (touchRotationEnabled && e.button === 1) {
      isDraggingRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (touchRotationEnabled && isDraggingRef.current) {
      const deltaX = e.clientX - lastMousePosRef.current.x;
      const deltaY = e.clientY - lastMousePosRef.current.y;
      
      // 取反以匹配设备旋转方向（设备上正值逆时针，Three.js 需要取反）
      if (touchRotationAxis === 'x') {
        rotationAngleRef.current.x -= deltaY / touchRotationSensitivity;
      } else if (touchRotationAxis === 'y') {
        rotationAngleRef.current.y -= deltaX / touchRotationSensitivity;
      } else if (touchRotationAxis === 'z') {
        rotationAngleRef.current.z -= deltaX / touchRotationSensitivity;
      }
      
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (touchRotationEnabled && isDraggingRef.current && e.button === 1) {
      isDraggingRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleMouseLeave = () => {
    handlers.onMouseLeave();
    if (touchRotationEnabled && isDraggingRef.current) {
      isDraggingRef.current = false;
    }
  };

  return (
    <div
      key={component.id}
      style={style}
      data-component-id={component.id}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseEnter={handlers.onMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handlers.onContextMenu}
    >
      {modelPath ? (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          {isLoading && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              padding: '10px 20px',
              borderRadius: '4px',
              fontSize: '12px',
              pointerEvents: 'none'
            }}>
              加载中...
            </div>
          )}
          {loadError && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(200, 0, 0, 0.8)',
              color: 'white',
              padding: '10px 20px',
              borderRadius: '4px',
              fontSize: '12px',
              textAlign: 'center',
              maxWidth: '80%'
            }}>
              {loadError}
            </div>
          )}

        </div>
      ) : (
        <div style={{ 
          width: '100%', 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'rgba(100, 100, 100, 0.2)',
          border: '2px dashed rgba(150, 150, 150, 0.5)',
          color: 'rgba(100, 100, 100, 0.8)',
          fontSize: '12px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>🧊</div>
          <div>3D模型组件</div>
          <div style={{ fontSize: '10px', marginTop: '4px' }}>拖拽 3D 模型文件到此处</div>
          <div style={{ fontSize: '10px', marginTop: '2px' }}>支持 OBJ/GLTF 格式</div>
          <div style={{ fontSize: '9px', marginTop: '2px', opacity: 0.7, textAlign: 'center', maxWidth: '200px' }}>
            OBJ格式：MTL材质和纹理需在同目录<br/>
            GLTF格式：BIN文件和纹理需在同目录
          </div>
        </div>
      )}
    </div>
  );
};
