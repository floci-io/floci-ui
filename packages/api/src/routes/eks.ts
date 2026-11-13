import { Hono } from "hono";
import { eksService as defaultEksService } from "../services/eks";

/** EKS routes bound to one EKS service, i.e. one account. */
export function createEksRouter(eksService: typeof defaultEksService = defaultEksService) {
  const app = new Hono();

  app.get("/clusters", async (c) => {
    return c.json(await eksService.listClusters());
  });

  app.get("/clusters/:name", async (c) => {
    return c.json(await eksService.describeCluster(c.req.param("name")));
  });

  app.get("/clusters/:name/nodegroups", async (c) => {
    return c.json(await eksService.listNodegroups(c.req.param("name")));
  });

  app.get("/clusters/:name/nodegroups/:nodegroup", async (c) => {
    return c.json(
      await eksService.describeNodegroup(
        c.req.param("name"),
        c.req.param("nodegroup"),
      ),
    );
  });

  app.post("/clusters/:name/nodegroups", async (c) => {
    const body = await c.req.json();
    return c.json(await eksService.createNodegroup(c.req.param("name"), body), 201);
  });

  app.delete("/clusters/:name/nodegroups/:nodegroup", async (c) => {
    return c.json(
      await eksService.deleteNodegroup(
        c.req.param("name"),
        c.req.param("nodegroup"),
      ),
    );
  });

  app.get("/clusters/:name/fargate-profiles", async (c) => {
    return c.json(await eksService.listFargateProfiles(c.req.param("name")));
  });

  app.get("/clusters/:name/fargate-profiles/:profile", async (c) => {
    return c.json(
      await eksService.describeFargateProfile(
        c.req.param("name"),
        c.req.param("profile"),
      ),
    );
  });

  app.post("/clusters/:name/fargate-profiles", async (c) => {
    const body = await c.req.json();
    return c.json(
      await eksService.createFargateProfile(c.req.param("name"), body),
      201,
    );
  });

  app.delete("/clusters/:name/fargate-profiles/:profile", async (c) => {
    return c.json(
      await eksService.deleteFargateProfile(
        c.req.param("name"),
        c.req.param("profile"),
      ),
    );
  });

  return app;
}

export default createEksRouter();
