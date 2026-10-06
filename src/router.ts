import { createRouter, createWebHashHistory } from 'vue-router';
import ReplacementView from './ReplacementView.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/models', component: { template: '<div />' } },
    { path: '/checks', component: { template: '<div />' } },
    { path: '/review', component: { template: '<div />' } },
    { path: '/replace', component: ReplacementView }
  ]
});
