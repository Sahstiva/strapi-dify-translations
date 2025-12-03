import type { Core } from '@strapi/strapi';

const bootstrap = ({ strapi }: { strapi: Core.Strapi }) => {
  // Bootstrap phase
  strapi.log.info('Dify Translations plugin bootstrapped');
};

export default bootstrap;

