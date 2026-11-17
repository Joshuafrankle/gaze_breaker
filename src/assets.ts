import { AssetType, defineAssets } from '@iwsdk/core';

export default defineAssets({
  'welcome-panel': {
    url: `${import.meta.env.BASE_URL}ui/welcome.uikitml`,
    type: AssetType.UIKitML,
    name: 'Welcome Panel',
  },
});
