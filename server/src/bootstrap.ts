import type { Core } from '@strapi/strapi';

const bootstrap = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.log.info('Dify Translations plugin bootstrapped');
};

export default bootstrap;
