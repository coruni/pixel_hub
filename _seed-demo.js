const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();
(async () => {
  const out = [];
  try {
    const pwd = bcrypt.hashSync("test1234", 10);
    const u = await prisma.user.upsert({
      where: { username: "draft_demo" },
      update: { passwordHash: pwd, trusted: true, bannedAt: null },
      create: {
        email: "draft_demo@example.com",
        username: "draft_demo",
        name: "草稿演示",
        passwordHash: pwd,
        trusted: true,
      },
      select: { id: true, username: true },
    });
    out.push("USER=" + u.username + " " + u.id);

    await prisma.resourceDraft.deleteMany({ where: { ownerId: u.id } });

    const music = {
      type: "MUSIC",
      title: "夜航星（像素 8bit 重编）",
      summary: "用芯片音源重编的一版夜航星",
      description: "这是一段用于验证草稿恢复与自动保存的示例正文，长度足够通过校验。",
      categoryId: "",
      tags: "8bit 芯片音乐",
      media: [],
      coverId: "",
      downloads: "[]",
      avSource: "mount",
      avUrl: "https://example.com/night-voyage.mp3",
      avMode: "direct",
      avProvider: "自建站",
      duration: "3:42",
      artist: "Hikari",
      album: "Pixel Nights",
      resolution: "",
      license: "免费",
      note: "仅供试听",
    };
    const article = {
      type: "ARTICLE",
      title: "像素画配色笔记",
      summary: "常见的 8 色复古配色",
      description: "记录几套常用的复古像素配色方案，附带十六进制色值，方便直接复制使用。",
      categoryId: "",
      tags: "配色 教程",
      media: [],
      coverId: "",
      downloads: "[]",
    };
    const a = await prisma.resourceDraft.create({
      data: { ownerId: u.id, type: "MUSIC", title: music.title, payload: JSON.stringify(music) },
      select: { id: true },
    });
    const b = await prisma.resourceDraft.create({
      data: { ownerId: u.id, type: "ARTICLE", title: article.title, payload: JSON.stringify(article) },
      select: { id: true },
    });
    out.push("DRAFT_MUSIC=" + a.id);
    out.push("DRAFT_ARTICLE=" + b.id);
  } catch (e) {
    out.push("ERR=" + e.message);
  } finally {
    await prisma.$disconnect();
    require("fs").writeFileSync(process.argv[2], out.join("\n"));
  }
})();
