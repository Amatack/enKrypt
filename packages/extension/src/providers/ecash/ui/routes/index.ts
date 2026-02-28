import { RouteRecordRaw } from 'vue-router';
import RouteNames from './names';

export default (namespace: string): RouteRecordRaw[] => {
  return Object.values(RouteNames).map(route => ({
    ...route,
    path: `/${namespace}/${route.path}`,
    name: `${namespace}-${String(route.name)}`,
  }));
};
