import { ProviderName, UIExportOptions } from '@/types/provider';
import getRoutes from './routes';

const uiExport: UIExportOptions = {
  providerName: ProviderName.ecash,
  routes: getRoutes(ProviderName.ecash),
};

export default uiExport;
