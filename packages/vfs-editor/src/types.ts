/**
 * VFS Editor 核心类型定义
 */

// ============================================
// 目录树 (VfsTree / Namespace)
// ============================================

/**
 * 虚拟文件系统目录树
 * 每个目录树是一个独立的命名空间
 */
export interface VfsTree {
  /** 唯一标识符 */
  id: string

  /** 目录树名称（用于区分不同的目录树） */
  name: string

  /** 描述信息 */
  description?: string

  /** 创建时间 (ISO 8601) */
  createdAt: string

  /** 更新时间 (ISO 8601) */
  updatedAt: string
}

// ============================================
// 来源类型 (VfsSourceType)
// ============================================

/**
 * 虚拟文件的来源类型
 */
export type VfsSourceType =
  | 'static'           // 静态字符串
  | 'online-docs'      // 在线文档
  | 'prompt-service'   // 提示词管理服务记录

// ============================================
// 来源配置 (VfsSourceConfig)
// ============================================

/**
 * 静态字符串内容类型
 */
export type StaticContentType = 'text' | 'markdown' | 'json' | 'yaml'

/**
 * 静态字符串配置
 */
export interface StaticSourceConfig {
  /** 文件内容 */
  content: string

  /** 内容类型，用于 Monaco Editor 语言高亮 */
  contentType?: StaticContentType
}

/**
 * 在线文档获取模式
 */
export type FetchMode = 'onLoad' | 'onDemand'

/**
 * 在线文档配置
 */
export interface OnlineDocsSourceConfig {
  /** 文档 URL */
  url: string

  /** 获取模式 */
  fetchMode: FetchMode

  /** 缓存时间（秒） */
  cacheSeconds?: number

  /** 请求头 */
  headers?: Record<string, string>
}

/**
 * 提示词服务配置
 */
export interface PromptServiceSourceConfig {
  /** 提示词 ID */
  promptId: string

  /** 版本号，不指定则使用最新版本 */
  version?: string

  /** 变量替换 */
  variables?: Record<string, string>
}

/**
 * 来源配置联合类型
 */
export type VfsSourceConfig =
  | StaticSourceConfig
  | OnlineDocsSourceConfig
  | PromptServiceSourceConfig

// ============================================
// 虚拟文件系统节点 (VfsNode)
// ============================================

/**
 * 节点类型
 */
export type VfsNodeType = 'file' | 'directory'

/**
 * 虚拟文件系统节点
 */
export interface VfsNode {
  /** 唯一标识符 */
  id: string

  /** 所属目录树 ID */
  treeId: string

  /** 节点名称（文件名或目录名） */
  name: string

  /** 完整路径，如 "/prompts/system/base.md" */
  path: string

  /** 父节点 ID，根节点为 null */
  parentId: string | null

  /** 节点类型：文件或目录 */
  type: VfsNodeType

  /** 来源类型（仅文件有效） */
  sourceType?: VfsSourceType

  /** 来源配置（根据 sourceType 不同而不同） */
  sourceConfig?: VfsSourceConfig

  /** 是否缓存（目录设置后会级联到所有子节点） */
  cached?: boolean

  /** 排序权重，数字越小越靠前 */
  sortOrder: number

  /** 元数据 */
  metadata?: Record<string, unknown>

  /** 创建时间 (ISO 8601) */
  createdAt: string

  /** 更新时间 (ISO 8601) */
  updatedAt: string
}

// ============================================
// 辅助类型
// ============================================

/**
 * 创建目录树的参数
 */
export type CreateVfsTreeParams = Pick<VfsTree, 'name' | 'description'>

/**
 * 更新目录树的参数
 */
export type UpdateVfsTreeParams = Partial<Pick<VfsTree, 'name' | 'description'>>

/**
 * 创建节点的参数
 */
export type CreateVfsNodeParams = Omit<VfsNode, 'id' | 'path' | 'createdAt' | 'updatedAt'>

/**
 * 更新节点的参数
 */
export type UpdateVfsNodeParams = Partial<Omit<VfsNode, 'id' | 'treeId' | 'createdAt' | 'updatedAt'>>

// ============================================
// 类型守卫函数
// ============================================

/**
 * 判断来源配置是否为静态字符串类型
 */
export function isStaticSourceConfig(
  config: VfsSourceConfig | undefined,
  sourceType: VfsSourceType | undefined
): config is StaticSourceConfig {
  return sourceType === 'static' && config !== undefined
}

/**
 * 判断来源配置是否为在线文档类型
 */
export function isOnlineDocsSourceConfig(
  config: VfsSourceConfig | undefined,
  sourceType: VfsSourceType | undefined
): config is OnlineDocsSourceConfig {
  return sourceType === 'online-docs' && config !== undefined
}

/**
 * 判断来源配置是否为提示词服务类型
 */
export function isPromptServiceSourceConfig(
  config: VfsSourceConfig | undefined,
  sourceType: VfsSourceType | undefined
): config is PromptServiceSourceConfig {
  return sourceType === 'prompt-service' && config !== undefined
}

// ============================================
// 常量
// ============================================

/**
 * 来源类型选项
 */
export const SOURCE_TYPE_OPTIONS: Array<{ value: VfsSourceType; label: string }> = [
  { value: 'static', label: '静态字符串' },
  { value: 'online-docs', label: '在线文档' },
  { value: 'prompt-service', label: '提示词服务' }
]

/**
 * 静态内容类型选项
 */
export const STATIC_CONTENT_TYPE_OPTIONS: Array<{ value: StaticContentType; label: string }> = [
  { value: 'text', label: '纯文本' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' }
]

/**
 * 获取模式选项
 */
export const FETCH_MODE_OPTIONS: Array<{ value: FetchMode; label: string }> = [
  { value: 'onLoad', label: '加载时获取' },
  { value: 'onDemand', label: '按需获取' }
]
