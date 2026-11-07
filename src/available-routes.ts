// 这些是已有页面的路由描述。管理模块接入真实接口后，再按角色加入对应路由。
export const availableRoutes = [
  {
    path: "home",
    name: "Home",
    component: "home",
    meta: {
      title: "首页",
      titleKey: "menu.home",
      icon: "HomeOutlined",
      showInMenu: true,
      order: 1,
    },
  },
  {
    path: "getting-started",
    name: "GettingStarted",
    redirect: "/getting-started/hello-world",
    meta: {
      title: "快速开始",
      titleKey: "menu.gettingStarted.title",
      icon: "UserOutlined",
      showInMenu: true,
      order: 2,
    },
    children: [
      {
        path: "hello-world",
        name: "HelloWorld",
        component: "getting-started/hello-world",
        meta: {
          title: "Hello World",
          titleKey: "menu.gettingStarted.helloWorld",
          showInMenu: true,
          order: 1,
        },
      },
      {
        path: "resolution-scale",
        name: "ResolutionScale",
        component: "getting-started/resolution-scale",
        meta: {
          title: "分辨率缩放",
          titleKey: "menu.gettingStarted.resolutionScale",
          showInMenu: true,
          order: 2,
        },
      },
    ],
  },
  {
    path: "showcases",
    name: "Showcases",
    redirect: "/showcases/google-2d-tiles",
    meta: {
      title: "示例展示",
      titleKey: "menu.showcases.title",
      icon: "DashboardOutlined",
      showInMenu: true,
      order: 3,
    },
    children: [
      {
        path: "google-2d-tiles",
        name: "Google2DTiles",
        component: "showcases/google-2d-tiles",
        meta: {
          title: "Google 2D Tiles",
          titleKey: "menu.showcases.google2dTiles",
          showInMenu: true,
          order: 1,
        },
      },
      {
        path: "tianditu-basic",
        name: "TiandituBasic",
        component: "showcases/tianditu-basic",
        meta: {
          title: "天地图基础测试",
          titleKey: "menu.showcases.tiandituBasic",
          showInMenu: true,
          order: 2,
        },
      },
    ],
  },
  {
    path: "hangzhou",
    name: "Hangzhou",
    redirect: "/hangzhou/regions",
    meta: {
      title: "杭州示例",
      titleKey: "menu.hangzhou.title",
      icon: "DashboardOutlined",
      showInMenu: true,
      order: 4,
    },
    children: [
      {
        path: "regions",
        name: "HangzhouRegions",
        component: "hangzhou/regions",
        meta: {
          title: "行政区",
          titleKey: "menu.hangzhou.regions",
          showInMenu: true,
          order: 1,
        },
      },
      {
        path: "boundaries",
        name: "HangzhouBoundaries",
        component: "hangzhou/boundaries",
        meta: {
          title: "边界分层",
          titleKey: "menu.hangzhou.boundaries",
          showInMenu: true,
          order: 2,
        },
      },
    ],
  },
  {
    path: "animation",
    name: "animation",
    meta: {
      title: "动画",
      titleKey: "menu.animation.title",
      icon: "SettingOutlined",
      showInMenu: true,
      order: 4,
    },
    redirect: "/animation/clock",
    children: [
      {
        path: "clock",
        name: "clock",
        component: "animation/clock",
        meta: {
          title: "时钟",
          titleKey: "menu.animation.clock",
          showInMenu: true,
          order: 1,
        },
      },
    ],
  },
  {
    path: "map",
    name: "Map",
    redirect: "/map/offline-map",
    meta: {
      title: "地图",
      titleKey: "menu.map.title",
      icon: "DashboardOutlined",
      showInMenu: true,
      order: 6,
    },
    children: [
      {
        path: "offline-map",
        name: "OfflineMap",
        component: "map/offline-map",
        meta: {
          title: "离线地图",
          titleKey: "menu.map.offlineMap",
          showInMenu: true,
          order: 1,
        },
      },
    ],
  },
];

// 普通用户只收到示例页；管理员额外收到已经实现的管理页面。
export function getAvailableRoutes(role: string) {
  if (role !== "admin") return availableRoutes;
  return [
    ...availableRoutes,
    {
      path: "system-management",
      name: "SystemManagement",
      redirect: "/system-management/user-management",
      meta: {
        title: "系统管理",
        titleKey: "menu.systemManagement.title",
        icon: "SettingOutlined",
        showInMenu: true,
        order: 5,
      },
      children: [
        {
          path: "user-management",
          name: "UserManagement",
          component: "system-management/user-management",
          meta: {
            title: "用户管理",
            titleKey: "menu.systemManagement.userManagement",
            showInMenu: true,
            order: 1,
          },
        },
        {
          path: "shelter-management",
          name: "ShelterManagement",
          component: "system-management/shelter-management",
          meta: {
            title: "避难场所管理",
            titleKey: "menu.systemManagement.shelterManagement",
            showInMenu: true,
            order: 2,
          },
        },
        {
          path: "airline-management",
          name: "AirlineManagement",
          component: "system-management/airline-management",
          meta: {
            title: "航线管理",
            titleKey: "menu.systemManagement.airlineManagement",
            showInMenu: true,
            order: 3,
          },
        },
        {
          path: "key-unit-management",
          name: "KeyUnitManagement",
          component: "system-management/key-unit-management",
          meta: {
            title: "重点单位管理",
            titleKey: "menu.systemManagement.keyUnitManagement",
            showInMenu: true,
            order: 4,
          },
        },
      ],
    },
  ];
}
