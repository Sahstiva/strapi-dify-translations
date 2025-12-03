import type { Core } from '@strapi/strapi';
import register from './register';
import bootstrap from './bootstrap';
import config from './config';
import routes from './routes';
import controllers from './controllers';
import services from './services';

export default {
  register,
  bootstrap,
  config,
  routes,
  controllers,
  services,
};

