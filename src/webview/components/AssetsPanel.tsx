import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Edit2, Upload, FolderUp, Zap, PackageCheck } from 'lucide-react';
import { AssetFile } from '../types';
import { useDesignerStore } from '../store';
import { t } from '../i18n';
import './AssetsPanel.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import Lottie from 'lottie-react';

// 文件类型分类
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];
const SVG_EXTS = ['svg'];
const VIDEO_EXTS = ['mp4', 'avi', 'mov', 'mkv', 'webm'];
const MODEL_EXTS = ['gltf', 'glb', 'obj'];  // 3D 模型主文件
const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];  // 字体文件
const GLASS_EXTS = ['glass'];  // 玻璃效果文件
const LOTTIE_EXTS = ['json', 'lottie']; // Lottie 动画文件
const TRMAP_EXTS = ['trmap']; // 纹理映射文件
const MODEL_DEP_EXTS = ['mtl', 'bin'];  // 3D 模型依赖文件（材质文件、二进制数据）

type AssetCategory = 'all' | 'images' | 'svgs' | 'videos' | 'models' | 'fonts' | 'glass' | 'lottie' | 'trmap';

// 视频预览组件
const VideoPreview: React.FC<{ videoPath: string }> = ({ videoPath }) => {
  const [error, setError] = useState(false);
  
  if (error) {
    const fileName = videoPath.split('/').pop() || '';
    return (
      <div style={{ 
        width: '100%', 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column',
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#1a1a2e',
        color: '#fff'
      }}>
        <div style={{ fontSize: '32px' }}>▶️</div>
        <div style={{ fontSize: '10px', marginTop: '4px' }}>{fileName}</div>
      </div>
    );
  }

  return (
    <video 
      src={videoPath}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onLoadedData={(e) => {
        // 跳到第一帧
        (e.target as HTMLVideoElement).currentTime = 0.1;
      }}
      onError={() => setError(true)}
    />
  );
};

// 3D 模型预览组件
const Model3DPreview: React.FC<{ modelPath: string }> = ({ modelPath }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [error, setError] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !modelPath) return;

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true,
      preserveDrawingBuffer: true  // 保持绘制缓冲区，防止内容丢失
    });
    renderer.setSize(100, 100);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.sortObjects = true;
    rendererRef.current = renderer;
    
    // 监听WebGL上下文丢失和恢复
    const canvas = renderer.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.warn('[3D预览] WebGL上下文丢失');
    };
    
    const handleContextRestored = () => {
      console.log('[3D预览] WebGL上下文恢复，重新渲染');
      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);
    
    containerRef.current.appendChild(renderer.domElement);

    // 添加光源（与设计窗口一致）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(5, -5, -5);
    scene.add(directionalLight1);
    
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-5, 5, 5);
    scene.add(directionalLight2);

    const ext = modelPath.split('.').pop()?.toLowerCase();

    const onLoadSuccess = (model: THREE.Object3D) => {
      // 先重置骨骼到初始姿态（修复带骨骼动画的模型）
      model.traverse((child: any) => {
        if (child.isSkinnedMesh && child.skeleton) {
          child.skeleton.pose();
        }
      });
      
      // 调整坐标系：正X向右，正Y向下，正Z向里（与设计窗口一致）
      model.rotation.x = Math.PI;
      
      scene.add(model);
      
      // 强制更新世界矩阵（确保骨骼变换生效）
      model.updateMatrixWorld(true);
      
      // 计算模型边界并居中
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // 将模型移到中心
      model.position.sub(center);
      
      // 调整相机位置以适应模型大小
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5;
      camera.position.z = cameraZ;
      camera.lookAt(0, 0, 1);
      
      // 初始渲染
      renderer.render(scene, camera);
      
      // 生成缩略图并保存
      setTimeout(() => {
        renderer.render(scene, camera);
        try {
          const dataURL = renderer.domElement.toDataURL('image/png');
          setThumbnail(dataURL);
          
          // 生成缩略图后，清理WebGL资源
          renderer.dispose();
          scene.clear();
          if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
            containerRef.current.removeChild(renderer.domElement);
          }
          rendererRef.current = null;
          sceneRef.current = null;
          cameraRef.current = null;
        } catch (err) {
          console.warn('[3D预览] 生成缩略图失败:', err);
        }
      }, 200);
    };

    if (ext === 'gltf' || ext === 'glb') {
      const loader = new GLTFLoader();
      const gltfPath = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
      const gltfFileName = modelPath.substring(modelPath.lastIndexOf('/') + 1);
      
      loader.setPath(gltfPath);
      loader.load(
        gltfFileName,
        (gltf) => onLoadSuccess(gltf.scene),
        undefined,
        () => setError(true)
      );
    } else if (ext === 'obj') {
      const mtlPath = modelPath.replace(/\.obj$/i, '.mtl');
      const mtlLoader = new MTLLoader();
      
      const texturePath = mtlPath.substring(0, mtlPath.lastIndexOf('/') + 1);
      const mtlFileName = mtlPath.substring(mtlPath.lastIndexOf('/') + 1);
      
      mtlLoader.setPath(texturePath);
      mtlLoader.load(
        mtlFileName,
        (materials) => {
          materials.preload();
          
          // 修复材质（与设计窗口一致）
          Object.keys(materials.materials).forEach((key) => {
            const mat = materials.materials[key] as any;
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
          
          const objLoader = new OBJLoader();
          const objPath = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
          const objFileName = modelPath.substring(modelPath.lastIndexOf('/') + 1);
          
          objLoader.setPath(objPath);
          objLoader.setMaterials(materials);
          objLoader.load(
            objFileName,
            (obj) => {
              // 确保材质正确应用
              obj.traverse((child: any) => {
                if (child.isMesh && child.material) {
                  if (child.material.type === 'MeshPhongMaterial') {
                    child.material.side = THREE.DoubleSide;
                    child.material.needsUpdate = true;
                  }
                }
              });
              onLoadSuccess(obj);
            },
            undefined,
            () => setError(true)
          );
        },
        undefined,
        () => {
          // MTL 加载失败，使用默认材质
          const objLoader = new OBJLoader();
          const objPath = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
          const objFileName = modelPath.substring(modelPath.lastIndexOf('/') + 1);
          
          objLoader.setPath(objPath);
          objLoader.load(
            objFileName,
            (obj) => {
              obj.traverse((child: any) => {
                if (child.isMesh) {
                  child.material = new THREE.MeshStandardMaterial({
                    color: 0xcccccc,
                    side: THREE.DoubleSide
                  });
                }
              });
              onLoadSuccess(obj);
            },
            undefined,
            () => setError(true)
          );
        }
      );
    }

    return () => {
      const canvas = rendererRef.current?.domElement;
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', () => {});
        canvas.removeEventListener('webglcontextrestored', () => {});
      }
      
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (containerRef.current && rendererRef.current.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
      }
      
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [modelPath]);

  if (error) {
    return <div className="file-icon" style={{ fontSize: '48px' }}>🧊</div>;
  }

  // 如果已生成缩略图，显示图片而不是WebGL canvas
  if (thumbnail) {
    return (
      <img 
        src={thumbnail} 
        alt="3D Model Preview" 
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};

// Glass 文件预览组件（将 .glass 文件作为 SVG 显示）
const GlassPreview: React.FC<{ glassPath: string }> = ({ glassPath }) => {
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // 通过 fetch 获取 .glass 文件内容，然后转换为 data URL
    fetch(glassPath)
      .then(response => response.text())
      .then(svgContent => {
        // 创建 SVG data URL
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
        setSvgDataUrl(dataUrl);
      })
      .catch(() => setError(true));
  }, [glassPath]);

  if (error || !svgDataUrl) {
    return <div className="file-icon" style={{ fontSize: '48px' }}>🔮</div>;
  }

  return (
    <img
      src={svgDataUrl}
      alt="Glass Preview"
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      onError={() => setError(true)}
    />
  );
};

// Lottie 动画预览组件
const LottiePreview: React.FC<{ lottiePath: string }> = ({ lottiePath }) => {
  const [animationData, setAnimationData] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(lottiePath)
      .then(res => res.json())
      .then(data => {
        // 验证是否为有效的 Lottie 数据
        // Lottie 文件通常包含 layers 数组
        if (data && Array.isArray(data.layers)) {
          setAnimationData(data);
        } else {
          // 如果不是有效的 Lottie 文件（可能是普通 json），显示错误/警告图标
          console.warn(`File ${lottiePath} is not a valid Lottie animation.`);
          setError(true);
        }
      })
      .catch((err) => {
        console.error("Failed to load Lottie:", err);
        setError(true);
      });
  }, [lottiePath]);

  if (error) return <div className="file-icon" style={{ fontSize: '48px' }}>📄</div>;
  if (!animationData) return <div className="loading">...</div>;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Lottie animationData={animationData} loop={true} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

// 获取文件扩展名
const getFileExt = (name: string): string => {
  return name.split('.').pop()?.toLowerCase() || '';
};

// 判断文件类型
const getAssetCategory = (name: string): AssetCategory | null => {
  const ext = getFileExt(name);
  if (IMAGE_EXTS.includes(ext)) return 'images';
  if (SVG_EXTS.includes(ext)) return 'svgs';
  if (VIDEO_EXTS.includes(ext)) return 'videos';
  if (MODEL_EXTS.includes(ext)) return 'models';
  if (FONT_EXTS.includes(ext)) return 'fonts';
  if (GLASS_EXTS.includes(ext)) return 'glass';
  if (LOTTIE_EXTS.includes(ext)) return 'lottie';
  if (TRMAP_EXTS.includes(ext)) return 'trmap';
  return null;
};

// 判断是否是 3D 模型依赖文件（用于统计到 models 分类）
const isModelDependency = (name: string): boolean => {
  const ext = getFileExt(name);
  return MODEL_DEP_EXTS.includes(ext);
};

const AssetsPanel: React.FC = () => {
  const [assets, setAssets] = useState<AssetFile[]>([]);
  const activeCategory = useDesignerStore((state) => state.assetCategory);
  const setActiveCategory = useDesignerStore((state) => state.setAssetCategory);
  const selectedAsset = useDesignerStore((state) => state.selectedAsset);
  const setSelectedAsset = useDesignerStore((state) => state.setSelectedAsset);
  const selectComponent = useDesignerStore((state) => state.selectComponent);
  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [gridColumns, setGridColumns] = useState(3);
  const [currentPath, setCurrentPath] = useState<string[]>([]);  // 当前浏览路径
  const [alwaysConvertAssets, setAlwaysConvertAssets] = useState<Set<string>>(new Set());  // 强制转换的资源集合
  const [smartPacking, setSmartPacking] = useState(false);  // 灵活打包模式
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 获取当前路径下的内容（仅用于"全部"分类）
  const getCurrentFolderContent = React.useMemo(() => {
    let current = assets;
    
    // 根据 currentPath 导航到目标文件夹
    for (const folderName of currentPath) {
      const folder = current.find(item => item.type === 'folder' && item.name === folderName);
      if (folder && folder.children) {
        current = folder.children;
      } else {
        return { folders: [], files: [] };
      }
    }
    
    // 分离文件夹和文件
    const folders = current.filter(item => item.type === 'folder');
    const files = current.filter(item => item.type !== 'folder');
    
    return { folders, files };
  }, [assets, currentPath]);

  // 按类型分类资源
  const categorizedAssets = React.useMemo(() => {
    const result: Record<AssetCategory, AssetFile[]> = {
      all: [],
      images: [],
      svgs: [],
      videos: [],
      models: [],
      fonts: [],
      glass: [],
      lottie: [],
      trmap: []
    };
    
    // 递归扁平化所有文件，用于统计各分类数量
    const processAllAssets = (assetList: AssetFile[]) => {
      for (const asset of assetList) {
        if (asset.isUserAsset) continue; // user 目录资源不计入分类统计
        if (asset.type === 'folder' && asset.children) {
          processAllAssets(asset.children);
        } else {
          const category = getAssetCategory(asset.name);
          if (category && category !== 'all') {
            result[category].push(asset);
          }
          if (isModelDependency(asset.name)) {
            result.models.push(asset);
          }
        }
      }
    };
    
    // 始终处理所有资源以统计数量
    processAllAssets(assets);
    
    // "全部"分类：使用当前目录的文件
    if (activeCategory === 'all') {
      const { files } = getCurrentFolderContent;
      result.all = [];
      for (const asset of files) {
        if (asset.isUserAsset) {
          // user 目录资源直接显示，不过滤类型
          result.all.push(asset);
        } else {
          const category = getAssetCategory(asset.name);
          if (category) {
            result.all.push(asset);
          }
          if (isModelDependency(asset.name)) {
            result.all.push(asset);
          }
        }
      }
    }
    
    return result;
  }, [assets, currentPath, getCurrentFolderContent, activeCategory]);

  // 获取各类型数量
  const counts = React.useMemo(() => {
    // "全部" 的数量应该是所有分类的总和
    const allCount = categorizedAssets.images.length + 
                     categorizedAssets.svgs.length + 
                     categorizedAssets.videos.length + 
                     categorizedAssets.models.length + 
                     categorizedAssets.fonts.length + 
                     categorizedAssets.glass.length + 
                     categorizedAssets.lottie.length +
                     categorizedAssets.trmap.length;
    
    return {
      all: allCount,
      images: categorizedAssets.images.length,
      svgs: categorizedAssets.svgs.length,
      videos: categorizedAssets.videos.length,
      models: categorizedAssets.models.length,
      fonts: categorizedAssets.fonts.length,
      glass: categorizedAssets.glass.length,
      lottie: categorizedAssets.lottie.length,
      trmap: categorizedAssets.trmap.length
    };
  }, [categorizedAssets]);

  useEffect(() => {
    window.vscodeAPI?.postMessage({ command: 'loadAssets' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'assetsLoaded') {
        setAssets(message.assets || []);
      } else if (message.command === 'alwaysConvertUpdated') {
        // 更新强制转换资源列表
        const alwaysConvert = message.alwaysConvert || { images: [], videos: [], models: [], fonts: [] };
        const allAssets = new Set<string>([
          ...(alwaysConvert.images || []),
          ...(alwaysConvert.videos || []),
          ...(alwaysConvert.models || []),
          ...(alwaysConvert.fonts || [])
        ]);
        setAlwaysConvertAssets(allAssets);
      } else if (message.command === 'smartPackingUpdated') {
        setSmartPacking(message.smartPacking === true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleDelete = (asset: AssetFile) => {
    const fileName = asset.relativePath || asset.name;
    // 发送确认删除请求到 Extension 端，由 Extension 端显示确认对话框
    window.vscodeAPI?.postMessage({
      command: 'confirmDeleteAsset',
      fileName: fileName,
      assetName: asset.name,
      isFolder: asset.type === 'folder'
    });
  };

  const handleRename = (asset: AssetFile) => {
    setEditingAsset(asset.path);
    setNewName(asset.name);
  };

  const handleRenameConfirm = (asset: AssetFile) => {
    if (newName && newName !== asset.name) {
      window.vscodeAPI?.postMessage({
        command: 'renameAsset',
        oldPath: asset.relativePath || asset.name,
        newName,
      });
    }
    setEditingAsset(null);
  };

  /**
   * 处理切换强制转换状态
   */
  const handleToggleAlwaysConvert = (assetPath: string) => {
    window.vscodeAPI?.postMessage({
      command: 'toggleAlwaysConvert',
      assetPath: assetPath
    });
  };

  /**
   * 检查资源是否在强制转换列表中
   * 文件夹：检查是否存在 "folder/**" glob 模式
   */
  const isAlwaysConvert = (assetPath: string): boolean => {
    if (alwaysConvertAssets.has(assetPath)) { return true; }
    // 检查文件夹 glob 模式
    const globPattern = `${assetPath}/**`;
    return alwaysConvertAssets.has(globPattern);
  };

  /**
   * 处理资源点击事件
   * 点击资源时选中该资源，同时清除组件选中状态
   * Requirements: 7.1, 7.2
   */
  const handleAssetClick = (asset: AssetFile, e: React.MouseEvent) => {
    // 阻止事件冒泡，避免触发其他点击事件
    e.stopPropagation();
    
    // 选中资源
    setSelectedAsset(asset);
    
    // 清除组件选中状态，使右侧面板显示 ConversionConfigPanel
    selectComponent(null);
  };

  /**
   * 处理文件夹点击事件
   * 单击选中文件夹，双击进入文件夹
   * Requirements: 7.1
   */
  const handleFolderClick = (folder: AssetFile, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // 选中文件夹
    setSelectedAsset(folder);
    
    // 清除组件选中状态
    selectComponent(null);
  };

  /**
   * 处理文件夹双击事件
   * 双击进入文件夹
   */
  const handleFolderDoubleClick = (folder: AssetFile, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // 进入文件夹
    setCurrentPath([...currentPath, folder.name]);
  };

  const renderAssetItem = (asset: AssetFile) => {
    const ext = getFileExt(asset.name);
    const isImage = IMAGE_EXTS.includes(ext) || SVG_EXTS.includes(ext);
    const isVideo = VIDEO_EXTS.includes(ext);
    const isModel = MODEL_EXTS.includes(ext);
    const isFont = FONT_EXTS.includes(ext);
    const isGlass = GLASS_EXTS.includes(ext);  // 玻璃效果文件
    const isLottie = LOTTIE_EXTS.includes(ext); // Lottie 动画文件
    const isTrmap = TRMAP_EXTS.includes(ext); // 纹理映射文件
    const isModelDep = MODEL_DEP_EXTS.includes(ext);  // 模型依赖文件（.mtl, .bin）
    const isSelected = selectedAsset?.path === asset.path;
    const isMarkedAlwaysConvert = asset.relativePath ? isAlwaysConvert(asset.relativePath) : false;
    
    return (
      <div 
        key={asset.path} 
        className={`asset-grid-item${isSelected ? ' selected' : ''}${smartPacking && isMarkedAlwaysConvert ? ' always-convert' : ''}`}
        draggable
        onClick={(e) => handleAssetClick(asset, e)}
        onDragStart={(e) => {
          e.dataTransfer.setData('asset-path', asset.relativePath || asset.name);
          e.dataTransfer.effectAllowed = 'copy';
          
          // 设置自定义拖拽图像，只显示预览区域，不包含文件名
          const previewEl = e.currentTarget.querySelector('.asset-preview') as HTMLElement;
          if (previewEl) {
            // 获取预览区域内的图片或其他元素
            const imgEl = previewEl.querySelector('img');
            if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
              // 使用图片本身作为拖拽图像
              e.dataTransfer.setDragImage(imgEl, imgEl.width / 2, imgEl.height / 2);
            } else {
              // 对于非图片资源，使用预览区域
              e.dataTransfer.setDragImage(previewEl, previewEl.offsetWidth / 2, previewEl.offsetHeight / 2);
            }
          }
        }}
      >
        <div className="asset-preview">
          {isImage && (
            <img
              src={asset.path}
              alt={asset.name}
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          {isGlass && <GlassPreview glassPath={asset.path} />}
          {isModel && <Model3DPreview modelPath={asset.path} />}
          {isVideo && <VideoPreview videoPath={asset.path} />}
          {isLottie && <LottiePreview lottiePath={asset.path} />}
          {isTrmap && <div className="file-icon" style={{ fontSize: '48px' }}>🗺️</div>}
          {isFont && <div className="file-icon" style={{ fontSize: '48px' }}>🔤</div>}
          {isModelDep && <div className="file-icon" style={{ fontSize: '48px' }}>📄</div>}
          {asset.type === 'raw' && <div className="file-icon" style={{ fontSize: '48px' }}>📄</div>}
        </div>
        <div className="asset-info">
          {editingAsset === asset.path ? (
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => handleRenameConfirm(asset)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm(asset);
                if (e.key === 'Escape') setEditingAsset(null);
              }}
              autoFocus
              className="rename-input"
            />
          ) : (
            <span className="asset-name" title={asset.name}>{asset.name}</span>
          )}
          <div className="asset-actions">
            {smartPacking && !asset.isUserAsset && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (asset.relativePath) {
                  handleToggleAlwaysConvert(asset.relativePath);
                }
              }} 
              title={isMarkedAlwaysConvert ? t('Remove from always convert') : t('Add to always convert')} 
              className={`action-btn force-convert-btn${isMarkedAlwaysConvert ? ' active' : ''}`}
              disabled={!asset.relativePath}
            >
              <Zap size={12} />
            </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); handleRename(asset); }} title={t('Rename')} className="action-btn">
              <Edit2 size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleDelete(asset); }} title={t('Delete')} className="action-btn delete">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderFolderItem = (folder: AssetFile) => {
    const isSelected = selectedAsset?.path === folder.path;
    const folderRelativePath = folder.relativePath || folder.name;
    const isMarkedAlwaysConvert = isAlwaysConvert(folderRelativePath);
    
    return (
      <div 
        key={folder.path} 
        className={`asset-grid-item folder-item${isSelected ? ' selected' : ''}${smartPacking && isMarkedAlwaysConvert ? ' always-convert' : ''}`}
        onClick={(e) => handleFolderClick(folder, e)}
        onDoubleClick={(e) => handleFolderDoubleClick(folder, e)}
      >
        <div className="asset-preview folder-preview">
          <div className="file-icon" style={{ fontSize: '48px' }}>{folder.isUserAsset ? '📦' : '📁'}</div>
        </div>
        <div className="asset-info">
          {editingAsset === folder.path ? (
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => handleRenameConfirm(folder)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm(folder);
                if (e.key === 'Escape') setEditingAsset(null);
              }}
              autoFocus
              className="rename-input"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="asset-name" title={folder.name}>{folder.name}</span>
          )}
          <div className="asset-actions">
            {smartPacking && !folder.isUserAsset && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleAlwaysConvert(folderRelativePath);
              }}
              title={isMarkedAlwaysConvert ? t('Remove from always convert') : t('Add to always convert')}
              className={`action-btn force-convert-btn${isMarkedAlwaysConvert ? ' active' : ''}`}
            >
              <Zap size={12} />
            </button>
            )}
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                handleRename(folder); 
              }} 
              title={t('Rename')} 
              className="action-btn"
            >
              <Edit2 size={12} />
            </button>
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                handleDelete(folder); 
              }} 
              title={t('Delete')} 
              className="action-btn delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const baseRelativePath = currentPath.length > 0 ? currentPath.join('/') : '';

    // 简化逻辑：拖拽什么就拷贝什么
    if (e.dataTransfer.items) {
      const items = Array.from(e.dataTransfer.items);
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          await processEntry(entry, baseRelativePath);
        }
      }
    } else if (e.dataTransfer.files) {
      Array.from(e.dataTransfer.files).forEach(file => processFile(file, baseRelativePath));
    }
  };

  const processEntry = async (entry: any, relativePath: string): Promise<void> => {
    if (entry.isFile) {
      entry.file((file: File) => processFile(file, relativePath));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      reader.readEntries((entries: any[]) => {
        entries.forEach(childEntry => {
          const newPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          processEntry(childEntry, newPath);
        });
      });
    }
  };

  const processFile = (file: File, relativePath: string) => {
    // 拷贝所有文件，不做过滤
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const json = JSON.parse(text);
        // 如果是有效的 Lottie 文件，且扩展名为 .json，则自动修改扩展名为 .lottie
        if (json && Array.isArray(json.layers) && file.name.toLowerCase().endsWith('.json')) {
            const newName = file.name.replace(/\.json$/i, '.lottie');
            
            // 重新读取为 ArrayBuffer 以便发送二进制数据
            const binaryReader = new FileReader();
            binaryReader.onload = (e) => {
                const arrayBuffer = e.target?.result as ArrayBuffer;
                const uint8Array = new Uint8Array(arrayBuffer);
                window.vscodeAPI?.postMessage({
                    command: 'saveImageToAssets',
                    fileName: newName,
                    fileData: Array.from(uint8Array),
                    relativePath: relativePath,
                    dropPosition: undefined,
                    targetContainerId: undefined
                });
            };
            binaryReader.readAsArrayBuffer(file);
            return;
        }
      } catch (e) {
        // 解析 JSON 失败，说明不是 JSON 文件，按普通文件处理
      }

      // 非 Lottie 的 JSON 文件，或者其他类型文件，正常上传
      // 注意：这里需要重新读取为 ArrayBuffer，因为第一次是为了检查内容读取为 Text
      const binaryReader = new FileReader();
      binaryReader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const uint8Array = new Uint8Array(arrayBuffer);
        window.vscodeAPI?.postMessage({
            command: 'saveImageToAssets',
            fileName: file.name,
            fileData: Array.from(uint8Array),
            relativePath: relativePath,
            dropPosition: undefined,
            targetContainerId: undefined
        });
      };
      binaryReader.readAsArrayBuffer(file);
    };

    // 先作为文本读取以检查内容
    if (file.name.toLowerCase().endsWith('.json')) {
        reader.readAsText(file);
    } else {
        // 非 json 文件直接作为二进制读取上传
        const binaryReader = new FileReader();
        binaryReader.onload = (e) => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            const uint8Array = new Uint8Array(arrayBuffer);
            window.vscodeAPI?.postMessage({
                command: 'saveImageToAssets',
                fileName: file.name,
                fileData: Array.from(uint8Array),
                relativePath: relativePath,
                dropPosition: undefined,
                targetContainerId: undefined
            });
        };
        binaryReader.readAsArrayBuffer(file);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 拷贝所有选中的文件，保留目录结构
    Array.from(files).forEach(file => {
      // webkitRelativePath 包含完整路径（如 "folder/subfolder/file.txt"）
      // 需要去掉文件名，只保留目录路径
      const relativePath = file.webkitRelativePath 
        ? file.webkitRelativePath.split('/').slice(0, -1).join('/')
        : '';
      processFile(file, relativePath);
    });
    
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const currentAssets = categorizedAssets[activeCategory];
  const { folders } = getCurrentFolderContent;
  const emptyMessage = activeCategory === 'all' ? t('No assets') : 
    activeCategory === 'images' ? t('No images') :
    activeCategory === 'svgs' ? t('No SVGs') :
    activeCategory === 'videos' ? t('No videos') : 
    activeCategory === 'models' ? t('No 3D models') :
    activeCategory === 'fonts' ? t('No fonts') :
    activeCategory === 'lottie' ? t('No Lottie files') : t('No glass assets');

  // 切换分类时重置路径
  const handleCategoryChange = (category: AssetCategory) => {
    setActiveCategory(category);
    if (category !== 'all') {
      setCurrentPath([]);  // 切换到其他分类时回到根目录
    }
  };

  return (
    <div className="assets-panel">
      <div className="assets-header">
        <select 
          className="category-select"
          value={activeCategory}
          onChange={(e) => handleCategoryChange(e.target.value as AssetCategory)}
        >
          <option value="all">{t('All')} ({counts.all})</option>
          <option value="images">{t('Images')} ({counts.images})</option>
          <option value="svgs">SVG ({counts.svgs})</option>
          <option value="videos">{t('Videos')} ({counts.videos})</option>
          <option value="models">3D ({counts.models})</option>
          <option value="fonts">{t('Fonts')} ({counts.fonts})</option>
          <option value="glass">{t('Glass')} ({counts.glass})</option>
          <option value="lottie">Lottie ({counts.lottie})</option>
        </select>
        <button 
          className="upload-btn" 
          onClick={() => fileInputRef.current?.click()}
          title={t('Upload files')}
        >
          <Upload size={16} />
        </button>
        <button 
          className="upload-btn" 
          onClick={() => folderInputRef.current?.click()}
          title={t('Upload folder')}
        >
          <FolderUp size={16} />
        </button>
        <button
          className={`upload-btn smart-packing-btn${smartPacking ? ' active' : ''}`}
          onClick={() => {
            window.vscodeAPI?.postMessage({ command: 'toggleSmartPacking' });
          }}
          title={smartPacking ? t('Smart packing enabled: only referenced assets are converted') : t('Smart packing disabled: all assets are converted')}
        >
          <PackageCheck size={16} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.gif,.bmp,.svg,.webp,.mp4,.avi,.mov,.mkv,.webm,.gltf,.glb,.obj,.mtl,.bin,.ttf,.otf,.woff,.woff2,.glass,.json,.lottie"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '' } as any)}
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>
      
      {/* 面包屑导航 - 仅在"全部"分类时显示 */}
      {activeCategory === 'all' && (
        <div className="breadcrumb">
          <span 
            className="breadcrumb-item" 
            onClick={() => setCurrentPath([])}
            title={t('Back to root')}
          >
            🏠 {t('Root')}
          </span>
          {currentPath.map((folder, index) => (
            <React.Fragment key={index}>
              <span className="breadcrumb-separator">/</span>
              <span 
                className="breadcrumb-item"
                onClick={() => setCurrentPath(currentPath.slice(0, index + 1))}
                title={folder}
              >
                {folder}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
      
      <div className="assets-toolbar">
        <input 
          type="range" 
          min="2" 
          max="6" 
          value={gridColumns} 
          onChange={(e) => setGridColumns(Number(e.target.value))}
          title={`${t('Columns')}: ${gridColumns}`}
        />
        <span className="grid-columns-label">{gridColumns} 列</span>
      </div>
      <div 
        className={`assets-content ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {folders.length === 0 && currentAssets.length === 0 ? (
          <div className="empty-state">
            <p>{emptyMessage}</p>
            <p className="hint">{t('Drag files here')}</p>
          </div>
        ) : (
          <div className="assets-grid" style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}>
            {activeCategory === 'all' && folders.map(folder => renderFolderItem(folder))}
            {currentAssets.map(asset => renderAssetItem(asset))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssetsPanel;
