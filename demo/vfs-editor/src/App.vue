<template>
  <div class="app">
    <header class="app-header">
      <span class="app-title" @click="$router.push('/')">xnl-vfs-editor</span>
      <span class="app-sub">虚拟文件系统编辑器 · 基于 xnl-vfs / xnl-vcs</span>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts"></script>

<style>
html, body, #app { height: 100%; margin: 0; }
.app { display: flex; flex-direction: column; height: 100vh; font-family: system-ui, sans-serif; }
.app-header {
  display: flex; align-items: baseline; gap: 12px;
  padding: 10px 16px; background: #1f2d3d; color: #fff;
}
.app-title { font-weight: 600; font-size: 16px; cursor: pointer; }
.app-sub { font-size: 12px; opacity: 0.7; }
.app-main { flex: 1; min-height: 0; }
</style>
