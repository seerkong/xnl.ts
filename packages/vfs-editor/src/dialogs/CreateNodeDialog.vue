<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="500"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
    >
      <el-form-item label="节点类型" prop="type">
        <el-radio-group v-model="form.type" :disabled="!!initialType">
          <el-radio value="directory">
            <el-icon><Folder /></el-icon>
            文件夹
          </el-radio>
          <el-radio value="file">
            <el-icon><Document /></el-icon>
            文件
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="名称" prop="name">
        <el-input
          v-model="form.name"
          placeholder="请输入名称"
          :maxlength="100"
          show-word-limit
        />
      </el-form-item>

      <el-form-item
        v-if="form.type === 'file'"
        label="来源类型"
        prop="sourceType"
      >
        <el-select v-model="form.sourceType" placeholder="请选择来源类型">
          <el-option
            v-for="option in allowedSourceTypeOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="缓存">
        <el-checkbox v-model="form.cached">
          {{ form.type === 'directory' ? '启用缓存（将级联应用到所有子节点）' : '启用缓存' }}
        </el-checkbox>
      </el-form-item>

      <el-form-item v-if="parentPath" label="父目录">
        <el-tag>{{ parentPath }}</el-tag>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" @click="handleSubmit" :loading="submitting">
        创建
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { Folder, Document } from '@element-plus/icons-vue'
import type { VfsNodeType, VfsSourceType } from '../types'
import { SOURCE_TYPE_OPTIONS } from '../types'

interface Props {
  /** 对话框可见性 */
  modelValue: boolean
  /** 父节点 ID */
  parentId?: string | null
  /** 父节点路径（用于显示） */
  parentPath?: string
  /** 初始节点类型（如果指定则不可更改） */
  initialType?: VfsNodeType
  /** 允许的来源类型 */
  allowedSourceTypes?: VfsSourceType[]
  /** 名称校验函数 */
  validateName?: (name: string) => boolean | string
}

const props = withDefaults(defineProps<Props>(), {
  parentId: null,
  parentPath: '',
  allowedSourceTypes: () => ['static', 'online-docs', 'prompt-service']
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit', data: {
    name: string
    type: VfsNodeType
    sourceType?: VfsSourceType
    cached?: boolean
    parentId: string | null
  }): void
}>()

const formRef = ref<FormInstance>()
const submitting = ref(false)

const form = ref({
  name: '',
  type: 'file' as VfsNodeType,
  sourceType: 'static' as VfsSourceType,
  cached: false
})

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const dialogTitle = computed(() => {
  if (props.initialType === 'directory') {
    return '新建文件夹'
  } else if (props.initialType === 'file') {
    return '新建文件'
  }
  return '新建节点'
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
        // 检查非法字符
        if (/[\/\\:*?"<>|]/.test(value)) {
          callback(new Error('名称不能包含 / \\ : * ? " < > | 等特殊字符'))
          return
        }
        // 使用外部校验函数
        if (props.validateName) {
          const result = props.validateName(value)
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
  type: [
    { required: true, message: '请选择节点类型', trigger: 'change' }
  ],
  sourceType: [
    {
      required: true,
      message: '请选择来源类型',
      trigger: 'change',
      validator: (_rule, value, callback) => {
        if (form.value.type === 'file' && !value) {
          callback(new Error('请选择来源类型'))
        } else {
          callback()
        }
      }
    }
  ]
}

function resetForm() {
  form.value = {
    name: '',
    type: props.initialType || 'file',
    sourceType: 'static',
    cached: false
  }
  formRef.value?.clearValidate()
}

function handleClose() {
  visible.value = false
  resetForm()
}

async function handleSubmit() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()

    submitting.value = true

    emit('submit', {
      name: form.value.name.trim(),
      type: form.value.type,
      sourceType: form.value.type === 'file' ? form.value.sourceType : undefined,
      cached: form.value.cached || undefined,
      parentId: props.parentId ?? null
    })

    handleClose()
  } catch {
    // 验证失败
  } finally {
    submitting.value = false
  }
}

// 当对话框打开时重置表单
watch(visible, (newVal) => {
  if (newVal) {
    resetForm()
  }
})

// 当初始类型变化时更新表单
watch(() => props.initialType, (newType) => {
  if (newType) {
    form.value.type = newType
  }
})
</script>

<style scoped>
.el-radio {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
