import * as fs from "fs";

type ResourceChange = {
  type: string;
  name: string;
  mode: string;
  module_address: string;
  address: string;
  change: {
    actions: string[];
    before?: unknown;
    after?: unknown;
  };
};

type TerraformPlan = {
  resource_changes: ResourceChange[];
};

export const findResourcesChanges = (
  pathToPlan: string,
  resourceTypes = [
    "azurerm_role_assignment",
    "azurerm_cosmosdb_sql_role_assignment",
    "azurerm_role_definition",
  ],
  changeActions = ["create", "update"]
) => {
  const planContent = fs.readFileSync(pathToPlan, "utf-8");
  const planJson = JSON.parse(planContent) as TerraformPlan;

  const roleAssignmentChanges = planJson.resource_changes.filter(
    (resourceChange) =>
      resourceTypes.some((type) => type === resourceChange.type) &&
      changeActions.some((action) =>
        resourceChange.change.actions.includes(action)
      )
  );

  return roleAssignmentChanges;
};
