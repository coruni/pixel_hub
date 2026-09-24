-- 个人主页背景：是否一并铺到本人发布的资源详情页。
-- 默认 true（铺）——目前只有个人主页一处展示，用户主动设了背景就是想让别人看到，
-- 延伸到自己的资源页是自然预期；不想铺的人自己在设置里关。
-- 只影响资源详情页；个人主页本身的展示不受这个开关影响。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgOnResource" BOOLEAN NOT NULL DEFAULT true;
