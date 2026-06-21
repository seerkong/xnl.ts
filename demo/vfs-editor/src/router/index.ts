import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import TreeListPage from "../views/TreeListPage.vue";
import TreeEditorPage from "../views/TreeEditorPage.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "trees", component: TreeListPage },
  { path: "/tree/:id", name: "editor", component: TreeEditorPage, props: true },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
