<template>
  <el-dialog
    v-model="visible"
    title="编辑节点"
    width="600"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
    >
      <!-- 基本信息 -->
      <el-form-item label="名称" prop="name">
        <el-input
          v-model="form.name"
          placeholder="请输入名称"
          :maxlength="100"
          show-word-limit
        />
      </el-form-item>

      <el-form-item label="路径">
        <el-tag>{{ node?.path || '-' }}</el-tag>
      </el-form-item>

      <!-- 文件来源配置 -->
      <template v-if="node?.type === 'file'">
        <el-divider content-position="left">来源配置</el-divider>

        <el-form-item label="来源类型" prop="sourceType">
          <el-select v-model="form.sourceType" @change="handleSourceTypeChange">
            <el-option
              v-for="option in allowedSourceTypeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <!-- 静态字符串配置 -->
        <template v-if="form.sourceType === 'static'">
          <el-form-item label="内容类型" prop="staticConfig.contentType">
            <el-select v-model="form.staticConfig.contentType">
              <el-option
                v-for="option in STATIC_CONTENT_TYPE_OPTIONS"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
        </template>

        <!-- 在线文档配置 -->
        <template v-if="form.sourceType === 'online-docs'">
          <el-form-item label="文档 URL" prop="onlineDocsConfig.url">
            <el-input
              v-model="form.onlineDocsConfig.url"
              placeholder="https://example.com/doc.md"
            />
          </el-form-item>
          <el-form-item label="获取模式" prop="onlineDocsConfig.fetchMode">
            <el-select v-model="form.onlineDocsConfig.fetchMode">
              <el-option
                v-for="option in FETCH_MODE_OPTIONS"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="缓存时间">
            <el-input-number
              v-model="form.onlineDocsConfig.cacheSeconds"
              :min="0"
              :max="86400"
              placeholder="秒"
            />
            <span style="margin-left: 8px; color: #909399;">秒（0 表示不缓存）</span>
          </el-form-item>
        </template>

        <!-- 提示词服务配置 -->
        <template v-if="form.sourceType === 'prompt-service'">
          <el-form-item label="提示词 ID" prop="promptServiceConfig.promptId">
            <el-input
              v-model="form.promptServiceConfig.promptId"
              placeholder="请输入提示词 ID"
            />
          </el-form-item>
          <el-form-item label="版本号">
            <el-input
              v-model="form.promptServiceConfig.version"
              placeholder="留空使用最新版本"
            />
          </el-form-item>
        </template>
      </template>

      <!-- 缓存配置 -->
      <el-divider content-position="left">缓存配置</el-divider>
      <el-form-item label="缓存">
        <el-checkbox v-model="form.cached">
          {{ node?.type === 'directory' ? '启用缓存（将级联应用到所有子节点）' : '启用缓存' }}
        </el-checkbox>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" @click="handleSubmit" :loading="submitting">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import type {
  VfsNode,
  VfsSourceType,
  VfsSourceConfig,
  StaticSourceConfig,
  OnlineDocsSourceConfig,
  PromptServiceSourceConfig,
  StaticContentType,
  FetchMode
} from '../types'
import {
  SOURCE_TYPE_OPTIONS,
  STATIC_CONTENT_TYPE_OPTIONS,
  FETCH_MODE_OPTIONS,
  isStaticSourceConfig,
  isOnlineDocsSourceConfig,
  isPromptServiceSourceConfig
} from '../types'

interface Props {
  /** 对话框可见性 */
  modelValue: boolean
  /** 要编辑的节点 */
  node?: VfsNode | null
  /** 允许的来源类型 */
  allowedSourceTypes?: VfsSourceType[]
  /** 名称校验函数 */
  validateName?: (name: string, excludeId?: string) => boolean | string
}

const props = withDefaults(defineProps<Props>(), {
  node: null,
  allowedSourceTypes: () => ['static', 'online-docs', 'prompt-service']
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit', data: {
    id: string
    name: string
    sourceType?: VfsSourceType
    sourceConfig?: VfsSourceConfig
    cached?: boolean
  }): void
}>()

const formRef = ref<FormInstance>()
const submitting = ref(false)

interface FormData {
  name: string
  sourceType: VfsSourceType
  cached: boolean
  staticConfig: {
    content: string
    contentType: StaticContentType
  }
  onlineDocsConfig: {
    url: string
    fetchMode: FetchMode
    cacheSeconds: number
  }
  promptServiceConfig: {
    promptId: string
    version: string
  }
}

const form = ref<FormData>({
  name: '',
  sourceType: 'static',
  cached: false,
  staticConfig: {
    content: '',
    contentType: 'text'
  },
  onlineDocsConfig: {
    url: '',
    fetchMode: 'onLoad',
    cacheSeconds: 0
  },
  promptServiceConfig: {
    promptId: '',
    version: ''
  }
})

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const allowedSourceTypeOptions = computed(() => {
  return SOURCE_TYPE_OPTIONS.filter(opt =>
    props.allowedSourceTypes.includes(opt.value)
  )
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入名称', trigger: 'blur' },
    { min: 1, max: 100, message: '名称长度为 1-100 个字符', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (/[\/\\:*?"<>|]/.test(value)) {
          callback(new Error('名称不能包含 / \\ : * ? " < > | 等特殊字符'))
          return
        }
        if (props.validateName && props.node) {
          const result = props.validateName(value, props.node.id)
          if (result !== true) {
            callback(new Error(typeof result === 'string' ? result : '名称不可用'))
            return
          }
        }
        callback()
      },
      trigger: 'blur'
    }
  ],
  'onlineDocsConfig.url': [
    {
      validator: (_rule, value, callback) => {
        if (form.value.sourceType === 'online-docs' && !value) {
          callback(new Error('请输入文档 URL'))
        } else if (value && !/^https?:\/\/.+/.test(value)) {
          callback(new Error('请输入有效的 URL'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  'promptServiceConfig.promptId': [
    {
      validator: (_rule, value, callback) => {
        if (form.value.sourceType === 'prompt-service' && !value) {
          callback(new Error('请输入提示词 ID'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

function loadNodeData() {
  if (!props.node) return

  form.value.name = props.node.name
  form.value.sourceType = props.node.sourceType || 'static'
  form.value.cached = props.node.cached || false

  const config = props.node.sourceConfig

  if (isStaticSourceConfig(config, props.node.sourceType)) {
    form.value.staticConfig = {
      content: config.content || '',
      contentType: config.contentType || 'text'
    }
  } else if (isOnlineDocsSourceConfig(config, props.node.sourceType)) {
    form.value.onlineDocsConfig = {
      url: config.url || '',
      fetchMode: config.fetchMode || 'onLoad',
      cacheSeconds: config.cacheSeconds || 0
    }
  } else if (isPromptServiceSourceConfig(config, props.node.sourceType)) {
    form.value.promptServiceConfig = {
      promptId: config.promptId || '',
      version: config.version || ''
    }
  }
}

function handleSourceTypeChange() {
  // 切换来源类型时重置对应配置
  form.value.staticConfig = { content: '', contentType: 'text' }
  form.value.onlineDocsConfig = { url: '', fetchMode: 'onLoad', cacheSeconds: 0 }
  form.value.promptServiceConfig = { promptId: '', version: '' }
}

function getSourceConfig(): VfsSourceConfig | undefined {
  switch (form.value.sourceType) {
    case 'static':
      return {
        content: form.value.staticConfig.content,
        contentType: form.value.staticConfig.contentType
      } as StaticSourceConfig
    case 'online-docs':
      return {
        url: form.value.onlineDocsConfig.url,
        fetchMode: form.value.onlineDocsConfig.fetchMode,
        cacheSeconds: form.value.onlineDocsConfig.cacheSeconds || undefined
      } as OnlineDocsSourceConfig
    case 'prompt-service':
      return {
        promptId: form.value.promptServiceConfig.promptId,
        version: form.value.promptServiceConfig.version || undefined
      } as PromptServiceSourceConfig
    default:
      return undefined
  }
}

function handleClose() {
  visible.value = false
}

async function handleSubmit() {
  if (!formRef.value || !props.node) return

  try {
    await formRef.value.validate()

    submitting.value = true

    emit('submit', {
      id: props.node.id,
      name: form.value.name.trim(),
      sourceType: props.node.type === 'file' ? form.value.sourceType : undefined,
      sourceConfig: props.node.type === 'file' ? getSourceConfig() : undefined,
      cached: form.value.cached || undefined
    })

    handleClose()
  } catch {
    // 验证失败
  } finally {
    submitting.value = false
  }
}

// 当节点变化时加载数据
watch(() => props.node, () => {
  if (props.modelValue && props.node) {
    loadNodeData()
  }
}, { immediate: true })

// 当对话框打开时加载数据
watch(visible, (newVal) => {
  if (newVal && props.node) {
    loadNodeData()
  }
})
</script>
