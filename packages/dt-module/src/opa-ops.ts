import { OPAClient } from "@styra/opa";
import axios from "axios";

/**
 * Policy interface for OPA policies
 */
export interface Policy {
  id: string;
  raw: string;
}

/**
 * OpaOps class for interacting with the OPA server
 */
export class OpaOps {
  private opaServerUrl: string;
  private opaInstance: any = null;

  /**
   * Constructor for OpaOps
   * @param opaServerUrl - The URL of the OPA server
   */
  constructor(opaServerUrl: string) {
    this.opaServerUrl = opaServerUrl;
    this.opaInstance = new OPAClient(opaServerUrl);
  }

  /**
   * Delete all OPA policies
   * @returns True if the policies were deleted successfully, false otherwise
   */
  async deleteAllPolicies(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.opaServerUrl}/v1/policies`);
      const existingPolicies = response.data.result || [];
      for (const policy of existingPolicies) {
        await axios.delete(`${this.opaServerUrl}/v1/policies/${policy.id}`);
      }
    } catch (error) {
      console.error("Error deleting OPA policies", error);
      return false;
    } finally {
      return true;
    }
  }

  /**
   * Delete an OPA policy
   * @param id - The ID of the policy to delete
   * @returns True if the policy was deleted successfully, false otherwise
   */
  async deletePolicy(id: string): Promise<boolean> {
    try {
      await axios.delete(`${this.opaServerUrl}/v1/policies/${id}`);
    } catch (error) {
      console.error("Error deleting OPA policy", error);
      return false;
    } finally {
      return true;
    }
  }

  /**
   * Delete an OPA policy by prefix
   * @param prefix - The prefix of the policy to delete
   * @returns True if the policy was deleted successfully, false otherwise
   */
  async deletePolicyByPrefix(prefix: string): Promise<boolean> {
    try {
      const response = await axios.get(`${this.opaServerUrl}/v1/policies`);
      const existingPolicies = response.data.result || [];
      for (const policy of existingPolicies) {
        if (policy.id.startsWith(prefix.trim().replaceAll(" ", "_"))) {
          await axios.delete(`${this.opaServerUrl}/v1/policies/${policy.id}`);
        }
      }
    } catch (error) {
      console.error("Error deleting OPA policy", error);
      return false;
    } finally {
      return true;
    }
  }

  /**
   * Install OPA policies
   * @param policies - The policies to install
   * @returns True if the policies were installed successfully, false otherwise
   */
  async installPolicies(policies: Policy[]): Promise<boolean> {
    let allSuccessful = true;
    for (const policy of policies) {
      try {
        const url = `${this.opaServerUrl}/v1/policies/${policy.id}`;
        await axios.put(url, policy.raw, {
          headers: {
            "Content-Type": "text/plain",
          },
        });
      } catch (error: any) {
        allSuccessful = false;
        // Extract detailed error information from OPA response
        const opaErrors = error?.response?.data?.errors;
        if (opaErrors && Array.isArray(opaErrors)) {
          console.error(`OPA policy compilation errors for ${policy.id}:`, JSON.stringify(opaErrors, null, 2));
          // Log first few lines of the policy for context
          const policyPreview = policy.raw.split('\n').slice(0, 5).join('\n');
          console.error(`Policy preview:\n${policyPreview}`);
        } else {
          console.error(`Error installing OPA policy ${policy.id}:`, error?.response?.data || error.message);
        }
        // Continue with other policies instead of failing completely
      }
    }
    return allSuccessful;
  }

  /**
   * Evaluate an OPA policy
   * @param path - The path to the OPA policy
   * @param input - The input to the OPA policy
   * @returns The result of the OPA policy evaluation
   */
  async evaluate(path: string, input: any): Promise<any> {
    try {
      const response = await this.opaInstance.evaluate(path, input);
      return response;
    } catch (error) {
      console.error("Error evaluating OPA policy", error);
      return null;
    }
  }
}