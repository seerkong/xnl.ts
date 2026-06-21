<template>
  <el-dialog
    v-model="visible"
    title="上传文件夹"
    width="500"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="upload-dialog-content">
      <el-form label-width="100px">
        <el-form-item label="目标目录">
          <el-tag v-if="targetPath">{{ targetPath }}</el-tag>
          <el-tag v-else type="info">/（根目录）</el-tag>
        </el-form-item>

        <el-form-item label="ZIP 文件">
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="handleFileChange"
            :on-exceed="handleExceed"
            accept=".zip"
            drag
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将 ZIP 文件拖到此处，或<em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                仅支持 .zip 格式的压缩文件
              </div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>

      <!-- 预览区域 -->
      <div v-if="previewItems.length > 0" class="preview-section">
        <div class="preview-header">
          <span>预览（共 {{ previewItems.length }} 个项目）</span>
          <el-checkbox v-model="importAsStatic" size="small">
            将文件内容导入为静态字符串
          </el-checkbox>
        </div>
        <div class="preview-list">
          <div
            v-for="item in previewItems"
            :key="item.path"
            class="preview-item"
            :class="{ 'is-directory': item.isDirectory }"
          >
            <el-icon v-if="item.isDirectory"><Folder /></el-icon>
            <el-icon v-else><Document /></el-icon>
            <span>{{ item.path }}{{ item.isDirectory ? '/' : '' }}</span>
            <span v-if="!item.isDirectory" class="file-size">
              {{ formatSize(item.size) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button
        type="primary"
        @click="handleSubmit"
        :loading="uploading"
        :disabled="!zipFile"
      >
        导入
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { UploadFile, UploadInstance } from 'element-plus'
import { ElMessage } from 'element-plus'
import { UploadFilled, Folder, Document } from '@element-plus/icons-vue'
import JSZip from 'jszip'

interface PreviewItem {
  path: string
  isDirectory: boolean
  size: number
  content?: string
}

interface ImportedNode {
  name: string
  path: string
  parentPath: string | null
  isDirectory: boolean
  content?: string
}

interface Props {
  modelValue: boolean
  targetParentId?: string | null
  targetPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  targetParentId: null,
  targetPath: ''
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit', nodes: ImportedNode[]): void
}>()

const uploadRef = ref<UploadInstance>()
const zipFile = ref<File | null>(null)
const previewItems = ref<PreviewItem[]>([])
const uploading = ref(false)
const importAsStatic = ref(true)

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function handleFileChange(uploadFile: UploadFile) {
  if (uploadFile.raw) {
    zipFile.value = uploadFile.raw
    parseZipFile(uploadFile.raw)
  }
}

function handleExceed() {
  ElMessage.warning('只能上传一个 ZIP 文件')
}

async function parseZipFile(file: File) {
  try {
    const zip = await JSZip.loadAsync(file)
    const items: PreviewItem[] = []

    // 获取所有文件和目录
    const entries = Object.entries(zip.files)

    for (const [path, zipEntry] of entries) {
      // 跳过 macOS 的隐藏文件
      if (path.startsWith('__MACOSX') || path.includes('/.')) continue

      // 清理路径（移除开头的斜杠）
      let cleanPath = path.replace(/^\/+/, '')

      // 跳过空路径
      if (!cleanPath) continue

      const isDirectory = zipEntry.dir

      // 移除目录末尾的斜杠（用于显示）
      if (isDirectory && cleanPath.endsWith('/')) {
        cleanPath = cleanPath.slice(0, -1)
      }

      let content: string | undefined
      let size = 0

      if (!isDirectory) {
        const blob = await zipEntry.async('blob')
        size = blob.size

        // 只读取文本文件的内容
        if (isTextFile(cleanPath) && size < 1024 * 1024) {
          content = await zipEntry.async('string')
        }
      }

      items.push({
        path: cleanPath,
        isDirectory,
        size,
        content
      })
    }

    // 按路径排序，目录在前
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.path.localeCompare(b.path)
    })

    previewItems.value = items
  } catch (e) {
    ElMessage.error('解析 ZIP 文件失败')
    console.error(e)
  }
}

function isTextFile(path: string): boolean {
  const textExtensions = [
    '.txt', '.md', '.markdown', '.json', '.yaml', '.yml',
    '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx',
    '.vue', '.py', '.java', '.c', '.cpp', '.h', '.go', '.rs',
    '.sh', '.bash', '.zsh', '.env', '.ini', '.conf', '.cfg',
    '.sql', '.graphql', '.proto', '.toml'
  ]
  const lowerPath = path.toLowerCase()
  return textExtensions.some(ext => lowerPath.endsWith(ext))
}

async function handleSubmit() {
  if (!zipFile.value || previewItems.value.length === 0) return

  uploading.value = true

  try {
    const nodes: ImportedNode[] = []

    // 构建目录结构
    const directories = new Set<string>()

    for (const item of previewItems.value) {
      // 收集所有需要创建的目录
      const parts = item.path.split('/')
      let currentPath = ''
      for (let i = 0; i < parts.length - (item.isDirectory ? 0 : 1); i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        directories.add(currentPath)
      }
    }

    // 先创建所有目录
    const sortedDirs = Array.from(directories).sort((a, b) => {
      const depthA = a.split('/').length
      const depthB = b.split('/').length
      if (depthA !== depthB) return depthA - depthB
      return a.localeCompare(b)
    })

    for (const dirPath of sortedDirs) {
      const parts = dirPath.split('/')
      const name = parts[parts.length - 1]
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null

      nodes.push({
        name,
        path: dirPath,
        parentPath,
        isDirectory: true
      })
    }

    // 再创建文件
    for (const item of previewItems.value) {
      if (item.isDirectory) continue

      const parts = item.path.split('/')
      const name = parts[parts.length - 1]
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null

      nodes.push({
        name,
        path: item.path,
        parentPath,
        isDirectory: false,
        content: importAsStatic.value ? item.content : undefined
      })
    }

    emit('submit', nodes)
    handleClose()
  } catch (e) {
    ElMessage.error('导入失败')
    console.error(e)
  } finally {
    uploading.value = false
  }
}

function handleClose() {
  visible.value = false
  zipFile.value = null
  previewItems.value = []
  uploadRef.value?.clearFiles()
}

watch(visible, (newVal) => {
  if (!newVal) {
    handleClose()
  }
})
</script>

<style scoped>
.upload-dialog-content {
  max-height: 60vh;
  overflow-y: auto;
}

.preview-section {
  margin-top: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  font-size: 14px;
  font-weight: 500;
}

.preview-list {
  max-height: 300px;
  overflow-y: auto;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: monospace;
}

.preview-item:hover {
  background: #f5f7fa;
}

.preview-item.is-directory {
  color: #e6a23c;
}

.file-size {
  margin-left: auto;
  color: #909399;
  font-size: 12px;
}
</style>
