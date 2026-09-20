import { z } from "zod";

export const demoPropsSchema = z.object({
  appName: z.string(),
  appUrl: z.string(),
});

export type DemoProps = z.infer<typeof demoPropsSchema>;

export const defaultDemoProps: DemoProps = {
  appName: "PosanMeal",
  appUrl: "http://localhost:3000",
};
