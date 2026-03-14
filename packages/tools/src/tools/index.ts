import type { PrismaClient } from "@openviktor/db";
import type { LLMProvider } from "@openviktor/shared";
import { ToolRegistry } from "../registry.js";
import {
	aiStructuredOutputDefinition,
	createAiStructuredOutputExecutor,
} from "./ai-structured-output.js";
import { bashDefinition, bashExecutor } from "./bash.js";
import {
	browserCloseSessionDefinition,
	browserCreateSessionDefinition,
	browserDownloadFilesDefinition,
	createBrowserExecutors,
} from "./browser.js";
import { coworkerText2ImDefinition, createText2ImExecutor } from "./coworker-text2im.js";
import {
	createCustomApiIntegrationDefinition,
	createCustomApiIntegrationExecutor,
} from "./create-custom-api-integration.js";
import {
	createDocsExecutors,
	queryLibraryDocsDefinition,
	resolveLibraryIdDefinition,
} from "./docs.js";
import { fileEditDefinition, fileEditExecutor } from "./file-edit.js";
import { fileReadDefinition, fileReadExecutor } from "./file-read.js";
import { fileToMarkdownDefinition, fileToMarkdownExecutor } from "./file-to-markdown.js";
import { fileWriteDefinition, fileWriteExecutor } from "./file-write.js";
import { coworkerGitDefinition, coworkerGithubCliDefinition, createGitExecutors } from "./git.js";
import { globDefinition, globExecutor } from "./glob.js";
import { grepDefinition, grepExecutor } from "./grep.js";
import {
	createReadLearningsExecutor,
	createWriteLearningExecutor,
	readLearningsDefinition,
	writeLearningDefinition,
} from "./learnings.js";
import { createQuickAiSearchExecutor, quickAiSearchDefinition } from "./quick-ai-search.js";
import {
	createListSkillsExecutor,
	createReadSkillExecutor,
	createWriteSkillExecutor,
	listSkillsDefinition,
	readSkillDefinition,
	writeSkillDefinition,
} from "./skills.js";
import {
	coworkerGetSlackReactionsDefinition,
	coworkerInviteSlackUserToTeamDefinition,
	coworkerJoinSlackChannelsDefinition,
	coworkerLeaveSlackChannelsDefinition,
	coworkerListSlackChannelsDefinition,
	coworkerListSlackUsersDefinition,
	coworkerOpenSlackConversationDefinition,
	coworkerReportIssueDefinition,
	createSlackAdminExecutors,
} from "./slack-admin.js";
import {
	coworkerDeleteSlackMessageDefinition,
	coworkerDownloadFromSlackDefinition,
	coworkerSendSlackMessageDefinition,
	coworkerSlackHistoryDefinition,
	coworkerSlackReactDefinition,
	coworkerUpdateSlackMessageDefinition,
	coworkerUploadToSlackDefinition,
	createSlackToolExecutors,
	createThreadDefinition,
	sendMessageToThreadDefinition,
	waitForPathsDefinition,
} from "./slack-comms.js";
import { viewImageDefinition, viewImageExecutor } from "./view-image.js";
import { workspaceTreeDefinition, workspaceTreeExecutor } from "./workspace-tree.js";

export interface RegistryConfig {
	slackToken?: string;
	githubToken?: string;
	browserbaseApiKey?: string;
	context7BaseUrl?: string;
	searchApiKey?: string;
	imagenApiKey?: string;
	llmProvider?: LLMProvider;
	defaultModel?: string;
}

export function createNativeRegistry(config: RegistryConfig = {}): ToolRegistry {
	const registry = new ToolRegistry();

	registry.register("bash", bashDefinition, bashExecutor);
	registry.register("file_read", fileReadDefinition, fileReadExecutor);
	registry.register("file_write", fileWriteDefinition, fileWriteExecutor);
	registry.register("file_edit", fileEditDefinition, fileEditExecutor);
	registry.register("glob", globDefinition, globExecutor);
	registry.register("grep", grepDefinition, grepExecutor);
	registry.register("view_image", viewImageDefinition, viewImageExecutor);

	registry.register("file_to_markdown", fileToMarkdownDefinition, fileToMarkdownExecutor);

	if (config.llmProvider) {
		registry.register(
			"ai_structured_output",
			aiStructuredOutputDefinition,
			createAiStructuredOutputExecutor(config.llmProvider, config.defaultModel),
		);
		registry.register(
			"quick_ai_search",
			quickAiSearchDefinition,
			createQuickAiSearchExecutor({
				searchApiKey: config.searchApiKey,
				llmProvider: config.llmProvider,
				model: config.defaultModel,
			}),
		);
	} else if (config.searchApiKey) {
		registry.register(
			"quick_ai_search",
			quickAiSearchDefinition,
			createQuickAiSearchExecutor({ searchApiKey: config.searchApiKey }),
		);
	}

	registry.register(
		"coworker_text2im",
		coworkerText2ImDefinition,
		createText2ImExecutor(config.imagenApiKey),
	);

	registry.register(
		"create_custom_api_integration",
		createCustomApiIntegrationDefinition,
		createCustomApiIntegrationExecutor,
	);

	registry.register("workspace_tree", workspaceTreeDefinition, workspaceTreeExecutor);

	if (config.slackToken) {
		const slackComms = createSlackToolExecutors(config.slackToken);
		registry.register(
			"coworker_slack_history",
			coworkerSlackHistoryDefinition,
			slackComms.coworker_slack_history,
		);
		registry.register(
			"coworker_send_slack_message",
			coworkerSendSlackMessageDefinition,
			slackComms.coworker_send_slack_message,
		);
		registry.register(
			"coworker_slack_react",
			coworkerSlackReactDefinition,
			slackComms.coworker_slack_react,
		);
		registry.register(
			"coworker_delete_slack_message",
			coworkerDeleteSlackMessageDefinition,
			slackComms.coworker_delete_slack_message,
		);
		registry.register(
			"coworker_update_slack_message",
			coworkerUpdateSlackMessageDefinition,
			slackComms.coworker_update_slack_message,
		);
		registry.register(
			"coworker_upload_to_slack",
			coworkerUploadToSlackDefinition,
			slackComms.coworker_upload_to_slack,
		);
		registry.register(
			"coworker_download_from_slack",
			coworkerDownloadFromSlackDefinition,
			slackComms.coworker_download_from_slack,
		);
		registry.register("create_thread", createThreadDefinition, slackComms.create_thread);
		registry.register(
			"send_message_to_thread",
			sendMessageToThreadDefinition,
			slackComms.send_message_to_thread,
		);
		registry.register("wait_for_paths", waitForPathsDefinition, slackComms.wait_for_paths);

		const slackAdmin = createSlackAdminExecutors(config.slackToken);
		registry.register(
			"coworker_list_slack_channels",
			coworkerListSlackChannelsDefinition,
			slackAdmin.coworker_list_slack_channels,
		);
		registry.register(
			"coworker_join_slack_channels",
			coworkerJoinSlackChannelsDefinition,
			slackAdmin.coworker_join_slack_channels,
		);
		registry.register(
			"coworker_open_slack_conversation",
			coworkerOpenSlackConversationDefinition,
			slackAdmin.coworker_open_slack_conversation,
		);
		registry.register(
			"coworker_leave_slack_channels",
			coworkerLeaveSlackChannelsDefinition,
			slackAdmin.coworker_leave_slack_channels,
		);
		registry.register(
			"coworker_list_slack_users",
			coworkerListSlackUsersDefinition,
			slackAdmin.coworker_list_slack_users,
		);
		registry.register(
			"coworker_invite_slack_user_to_team",
			coworkerInviteSlackUserToTeamDefinition,
			slackAdmin.coworker_invite_slack_user_to_team,
		);
		registry.register(
			"coworker_get_slack_reactions",
			coworkerGetSlackReactionsDefinition,
			slackAdmin.coworker_get_slack_reactions,
		);
		registry.register(
			"coworker_report_issue",
			coworkerReportIssueDefinition,
			slackAdmin.coworker_report_issue,
		);
	}

	const gitExecutors = createGitExecutors(config.githubToken);
	registry.register("coworker_git", coworkerGitDefinition, gitExecutors.coworker_git);
	registry.register(
		"coworker_github_cli",
		coworkerGithubCliDefinition,
		gitExecutors.coworker_github_cli,
	);

	if (config.browserbaseApiKey) {
		const browserExecutors = createBrowserExecutors(config.browserbaseApiKey);
		registry.register(
			"browser_create_session",
			browserCreateSessionDefinition,
			browserExecutors.browser_create_session,
		);
		registry.register(
			"browser_download_files",
			browserDownloadFilesDefinition,
			browserExecutors.browser_download_files,
		);
		registry.register(
			"browser_close_session",
			browserCloseSessionDefinition,
			browserExecutors.browser_close_session,
		);
	}

	const docsExecutors = createDocsExecutors(config.context7BaseUrl);
	registry.register(
		"resolve_library_id",
		resolveLibraryIdDefinition,
		docsExecutors.resolve_library_id,
	);
	registry.register(
		"query_library_docs",
		queryLibraryDocsDefinition,
		docsExecutors.query_library_docs,
	);

	return registry;
}

export function registerDbTools(registry: ToolRegistry, prisma: PrismaClient): void {
	const local = { localOnly: true };
	registry.register(
		"read_learnings",
		readLearningsDefinition,
		createReadLearningsExecutor(prisma),
		local,
	);
	registry.register(
		"write_learning",
		writeLearningDefinition,
		createWriteLearningExecutor(prisma),
		local,
	);
	registry.register("read_skill", readSkillDefinition, createReadSkillExecutor(prisma), local);
	registry.register("list_skills", listSkillsDefinition, createListSkillsExecutor(prisma), local);
	registry.register("write_skill", writeSkillDefinition, createWriteSkillExecutor(prisma), local);
}

export {
	listAvailableIntegrationsDefinition,
	listWorkspaceConnectionsDefinition,
	connectIntegrationDefinition,
	disconnectIntegrationDefinition,
	syncWorkspaceConnectionsDefinition,
	createListAvailableIntegrationsExecutor,
	createListWorkspaceConnectionsExecutor,
	createConnectIntegrationExecutor,
	createDisconnectIntegrationExecutor,
	createSyncWorkspaceConnectionsExecutor,
	createIntegrationSyncHandler,
	restoreToolsFromDb,
	convertConfigurableProps,
	actionKeyToToolName,
	extractToolSchemas,
} from "./integrations/index.js";
export type { IntegrationSyncHandler } from "./integrations/index.js";
