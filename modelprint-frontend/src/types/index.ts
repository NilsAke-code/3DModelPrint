export interface ModelImage {
  id: number;
  modelId: number;
  imagePath: string;
  sortOrder: number;
  imageType: "source" | "generated" | "stl-preview";
  createdAt: string;
}

export interface ModelPart {
  id: number;
  modelId: number;
  fileName: string;
  filePath: string;
  previewImagePath?: string;
  triangleCount: number;
  width: number;
  height: number;
  depth: number;
  sortOrder: number;
}

export interface ModelFileEntry {
  fileName: string;
  role: "stl" | "obj" | "glb" | "gltf" | "mtl" | "archive" | "other";
  path: string;
  sizeBytes?: number;
}

export interface Model3D {
  id: number;
  title: string;
  description: string;
  filePath: string;
  thumbnailPath: string;
  category: string;
  authorId: string;
  authorName: string;
  downloads: number;
  likes: number;
  createdAt: string;
  updatedAt: string;
  isExploreModel: boolean;
  packagePath?: string;
  sourceUrl?: string;
  tags: string[];
  images: ModelImage[];
  parts: ModelPart[];
}

export interface Tag {
  id: number;
  name: string;
}

export interface UserInfo {
  id: number;
  email: string;
  displayName: string;
  role: number;
}

export interface AdminStats {
  totalModels: number;
  totalUsers: number;
  totalDownloads: number;
  totalLikes: number;
  modelsLast7Days: number;
  modelsLast30Days: number;
  usersLast7Days: number;
  usersLast30Days: number;
}
