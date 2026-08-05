#!/usr/bin/env python3
"""
Generates BhekaAgent.xcodeproj/project.pbxproj programmatically.

This script is kept in the repo (not deleted) so the project file's structure is
auditable/regenerable rather than a black box. It produces a modern
(objectVersion 56 / Xcode 15+) pbxproj with two targets:
  - BhekaAgent               (iOS App)
  - BhekaBroadcastExtension  (Broadcast Upload Extension, embedded in BhekaAgent)

Run with: python3 generate_pbxproj.py
"""
import uuid

def gid():
    """24-hex-char uppercase ID, matching Xcode's UUID style for pbxproj object refs."""
    return uuid.uuid4().hex[:24].upper()

# ---------------------------------------------------------------------------
# Allocate stable IDs for every object we need to reference more than once.
# ---------------------------------------------------------------------------
ids = {
    # Project-level
    "project": gid(),
    "main_group": gid(),
    "products_group": gid(),
    "frameworks_group": gid(),

    # Groups
    "app_group": gid(),
    "app_assets_group": gid(),
    "app_appicon_group": gid(),
    "app_preview_group": gid(),
    "ext_group": gid(),

    # File refs - app target sources
    "f_app_swift": gid(),
    "f_contentview_swift": gid(),
    "f_config_swift": gid(),
    "f_apiclient_swift": gid(),
    "f_screencapture_swift": gid(),
    "f_appusage_swift": gid(),
    "f_ocr_swift": gid(),
    "f_imageproc_swift": gid(),
    "f_qrscanner_swift": gid(),
    "f_app_entitlements": gid(),
    "f_app_infoplist": gid(),
    "f_app_assets": gid(),
    "f_app_preview_assets": gid(),

    # File refs - extension target sources
    "f_ext_samplehandler_swift": gid(),
    "f_ext_apiclient_swift": gid(),
    "f_ext_entitlements": gid(),
    "f_ext_infoplist": gid(),

    # Frameworks (file refs to SDK frameworks)
    "fw_replaykit_app": gid(),
    "fw_vision_app": gid(),
    "fw_avfoundation_app": gid(),
    "fw_uikit_app": gid(),
    "fw_swiftui_app": gid(),
    "fw_corimage_app": gid(),
    "fw_videotoolbox_app": gid(),

    "fw_replaykit_ext": gid(),
    "fw_vision_ext": gid(),
    "fw_uikit_ext": gid(),
    "fw_corimage_ext": gid(),
    "fw_videotoolbox_ext": gid(),

    # Products
    "product_app": gid(),
    "product_ext": gid(),

    # Targets
    "target_app": gid(),
    "target_ext": gid(),

    # Native target build phases (app)
    "app_sources_phase": gid(),
    "app_frameworks_phase": gid(),
    "app_resources_phase": gid(),
    "app_embed_extensions_phase": gid(),

    # Native target build phases (extension)
    "ext_sources_phase": gid(),
    "ext_frameworks_phase": gid(),
    "ext_resources_phase": gid(),

    # Build file entries (sources)
    "bf_app_swift": gid(),
    "bf_contentview_swift": gid(),
    "bf_config_swift": gid(),
    "bf_apiclient_swift": gid(),
    "bf_screencapture_swift": gid(),
    "bf_appusage_swift": gid(),
    "bf_ocr_swift": gid(),
    "bf_imageproc_swift": gid(),
    "bf_qrscanner_swift": gid(),
    "bf_app_assets": gid(),
    "bf_app_preview_assets": gid(),

    "bf_ext_samplehandler_swift": gid(),
    "bf_ext_apiclient_swift": gid(),

    # Build file entries (frameworks)
    "bf_fw_replaykit_app": gid(),
    "bf_fw_vision_app": gid(),
    "bf_fw_avfoundation_app": gid(),
    "bf_fw_uikit_app": gid(),
    "bf_fw_swiftui_app": gid(),
    "bf_fw_coreimage_app": gid(),
    "bf_fw_videotoolbox_app": gid(),

    "bf_fw_replaykit_ext": gid(),
    "bf_fw_vision_ext": gid(),
    "bf_fw_uikit_ext": gid(),
    "bf_fw_coreimage_ext": gid(),
    "bf_fw_videotoolbox_ext": gid(),

    # Embed extension build file (product copy into main app's PlugIns)
    "bf_embed_ext": gid(),
    "container_item_proxy": gid(),
    "target_dependency": gid(),

    # Build configurations
    "proj_cfg_debug": gid(),
    "proj_cfg_release": gid(),
    "proj_cfg_list": gid(),

    "app_cfg_debug": gid(),
    "app_cfg_release": gid(),
    "app_cfg_list": gid(),

    "ext_cfg_debug": gid(),
    "ext_cfg_release": gid(),
    "ext_cfg_list": gid(),
}

DEVELOPMENT_TEAM_PLACEHOLDER = ""  # Developer must fill this in in Xcode (Signing & Capabilities).

pbxproj = f'''// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 56;
	objects = {{

/* Begin PBXBuildFile section */
		{ids["bf_app_swift"]} /* BhekaAgentApp.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_app_swift"]} /* BhekaAgentApp.swift */; }};
		{ids["bf_contentview_swift"]} /* ContentView.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_contentview_swift"]} /* ContentView.swift */; }};
		{ids["bf_config_swift"]} /* Config.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_config_swift"]} /* Config.swift */; }};
		{ids["bf_apiclient_swift"]} /* ApiClient.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_apiclient_swift"]} /* ApiClient.swift */; }};
		{ids["bf_screencapture_swift"]} /* ScreenCaptureManager.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_screencapture_swift"]} /* ScreenCaptureManager.swift */; }};
		{ids["bf_appusage_swift"]} /* AppUsageTracker.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_appusage_swift"]} /* AppUsageTracker.swift */; }};
		{ids["bf_ocr_swift"]} /* OCRProcessor.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_ocr_swift"]} /* OCRProcessor.swift */; }};
		{ids["bf_imageproc_swift"]} /* ImageProcessor.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_imageproc_swift"]} /* ImageProcessor.swift */; }};
		{ids["bf_qrscanner_swift"]} /* QRScanner.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_qrscanner_swift"]} /* QRScanner.swift */; }};
		{ids["bf_app_assets"]} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {ids["f_app_assets"]} /* Assets.xcassets */; }};
		{ids["bf_app_preview_assets"]} /* Preview Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {ids["f_app_preview_assets"]} /* Preview Assets.xcassets */; }};

		{ids["bf_ext_samplehandler_swift"]} /* SampleHandler.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_ext_samplehandler_swift"]} /* SampleHandler.swift */; }};
		{ids["bf_ext_apiclient_swift"]} /* ExtensionApiClient.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["f_ext_apiclient_swift"]} /* ExtensionApiClient.swift */; }};

		{ids["bf_fw_replaykit_app"]} /* ReplayKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_replaykit_app"]} /* ReplayKit.framework */; }};
		{ids["bf_fw_vision_app"]} /* Vision.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_vision_app"]} /* Vision.framework */; }};
		{ids["bf_fw_avfoundation_app"]} /* AVFoundation.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_avfoundation_app"]} /* AVFoundation.framework */; }};
		{ids["bf_fw_uikit_app"]} /* UIKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_uikit_app"]} /* UIKit.framework */; }};
		{ids["bf_fw_swiftui_app"]} /* SwiftUI.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_swiftui_app"]} /* SwiftUI.framework */; }};
		{ids["bf_fw_coreimage_app"]} /* CoreImage.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_corimage_app"]} /* CoreImage.framework */; }};
		{ids["bf_fw_videotoolbox_app"]} /* VideoToolbox.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_videotoolbox_app"]} /* VideoToolbox.framework */; }};

		{ids["bf_fw_replaykit_ext"]} /* ReplayKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_replaykit_ext"]} /* ReplayKit.framework */; }};
		{ids["bf_fw_vision_ext"]} /* Vision.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_vision_ext"]} /* Vision.framework */; }};
		{ids["bf_fw_uikit_ext"]} /* UIKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_uikit_ext"]} /* UIKit.framework */; }};
		{ids["bf_fw_coreimage_ext"]} /* CoreImage.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_corimage_ext"]} /* CoreImage.framework */; }};
		{ids["bf_fw_videotoolbox_ext"]} /* VideoToolbox.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {ids["fw_videotoolbox_ext"]} /* VideoToolbox.framework */; }};

		{ids["bf_embed_ext"]} /* BhekaBroadcastExtension.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {ids["product_ext"]} /* BhekaBroadcastExtension.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};
/* End PBXBuildFile section */

/* Begin PBXContainerItemProxy section */
		{ids["container_item_proxy"]} /* PBXContainerItemProxy */ = {{
			isa = PBXContainerItemProxy;
			containerPortal = {ids["project"]} /* Project object */;
			proxyType = 1;
			remoteGlobalIDString = {ids["target_ext"]};
			remoteInfo = BhekaBroadcastExtension;
		}};
/* End PBXContainerItemProxy section */

/* Begin PBXCopyFilesBuildPhase section */
		{ids["app_embed_extensions_phase"]} /* Embed Foundation Extensions */ = {{
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				{ids["bf_embed_ext"]} /* BhekaBroadcastExtension.appex in Embed Foundation Extensions */,
			);
			name = "Embed Foundation Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXCopyFilesBuildPhase section */

/* Begin PBXFileReference section */
		{ids["product_app"]} /* BhekaAgent.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = BhekaAgent.app; sourceTree = BUILT_PRODUCTS_DIR; }};
		{ids["product_ext"]} /* BhekaBroadcastExtension.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = BhekaBroadcastExtension.appex; sourceTree = BUILT_PRODUCTS_DIR; }};

		{ids["f_app_swift"]} /* BhekaAgentApp.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BhekaAgentApp.swift; sourceTree = "<group>"; }};
		{ids["f_contentview_swift"]} /* ContentView.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ContentView.swift; sourceTree = "<group>"; }};
		{ids["f_config_swift"]} /* Config.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = Config.swift; sourceTree = "<group>"; }};
		{ids["f_apiclient_swift"]} /* ApiClient.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ApiClient.swift; sourceTree = "<group>"; }};
		{ids["f_screencapture_swift"]} /* ScreenCaptureManager.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ScreenCaptureManager.swift; sourceTree = "<group>"; }};
		{ids["f_appusage_swift"]} /* AppUsageTracker.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppUsageTracker.swift; sourceTree = "<group>"; }};
		{ids["f_ocr_swift"]} /* OCRProcessor.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = OCRProcessor.swift; sourceTree = "<group>"; }};
		{ids["f_imageproc_swift"]} /* ImageProcessor.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ImageProcessor.swift; sourceTree = "<group>"; }};
		{ids["f_qrscanner_swift"]} /* QRScanner.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = QRScanner.swift; sourceTree = "<group>"; }};
		{ids["f_app_entitlements"]} /* BhekaAgent.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = BhekaAgent.entitlements; sourceTree = "<group>"; }};
		{ids["f_app_infoplist"]} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};
		{ids["f_app_assets"]} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};
		{ids["f_app_preview_assets"]} /* Preview Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = "Preview Assets.xcassets"; sourceTree = "<group>"; }};

		{ids["f_ext_samplehandler_swift"]} /* SampleHandler.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SampleHandler.swift; sourceTree = "<group>"; }};
		{ids["f_ext_apiclient_swift"]} /* ExtensionApiClient.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ExtensionApiClient.swift; sourceTree = "<group>"; }};
		{ids["f_ext_entitlements"]} /* BhekaBroadcastExtension.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = BhekaBroadcastExtension.entitlements; sourceTree = "<group>"; }};
		{ids["f_ext_infoplist"]} /* BhekaBroadcastExtension-Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "BhekaBroadcastExtension-Info.plist"; sourceTree = "<group>"; }};

		{ids["fw_replaykit_app"]} /* ReplayKit.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = ReplayKit.framework; path = System/Library/Frameworks/ReplayKit.framework; sourceTree = SDKROOT; }};
		{ids["fw_vision_app"]} /* Vision.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = Vision.framework; path = System/Library/Frameworks/Vision.framework; sourceTree = SDKROOT; }};
		{ids["fw_avfoundation_app"]} /* AVFoundation.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = AVFoundation.framework; path = System/Library/Frameworks/AVFoundation.framework; sourceTree = SDKROOT; }};
		{ids["fw_uikit_app"]} /* UIKit.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = UIKit.framework; path = System/Library/Frameworks/UIKit.framework; sourceTree = SDKROOT; }};
		{ids["fw_swiftui_app"]} /* SwiftUI.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = SwiftUI.framework; path = System/Library/Frameworks/SwiftUI.framework; sourceTree = SDKROOT; }};
		{ids["fw_corimage_app"]} /* CoreImage.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = CoreImage.framework; path = System/Library/Frameworks/CoreImage.framework; sourceTree = SDKROOT; }};
		{ids["fw_videotoolbox_app"]} /* VideoToolbox.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = VideoToolbox.framework; path = System/Library/Frameworks/VideoToolbox.framework; sourceTree = SDKROOT; }};

		{ids["fw_replaykit_ext"]} /* ReplayKit.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = ReplayKit.framework; path = System/Library/Frameworks/ReplayKit.framework; sourceTree = SDKROOT; }};
		{ids["fw_vision_ext"]} /* Vision.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = Vision.framework; path = System/Library/Frameworks/Vision.framework; sourceTree = SDKROOT; }};
		{ids["fw_uikit_ext"]} /* UIKit.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = UIKit.framework; path = System/Library/Frameworks/UIKit.framework; sourceTree = SDKROOT; }};
		{ids["fw_corimage_ext"]} /* CoreImage.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = CoreImage.framework; path = System/Library/Frameworks/CoreImage.framework; sourceTree = SDKROOT; }};
		{ids["fw_videotoolbox_ext"]} /* VideoToolbox.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = VideoToolbox.framework; path = System/Library/Frameworks/VideoToolbox.framework; sourceTree = SDKROOT; }};
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		{ids["app_frameworks_phase"]} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids["bf_fw_replaykit_app"]} /* ReplayKit.framework in Frameworks */,
				{ids["bf_fw_vision_app"]} /* Vision.framework in Frameworks */,
				{ids["bf_fw_avfoundation_app"]} /* AVFoundation.framework in Frameworks */,
				{ids["bf_fw_uikit_app"]} /* UIKit.framework in Frameworks */,
				{ids["bf_fw_swiftui_app"]} /* SwiftUI.framework in Frameworks */,
				{ids["bf_fw_coreimage_app"]} /* CoreImage.framework in Frameworks */,
				{ids["bf_fw_videotoolbox_app"]} /* VideoToolbox.framework in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{ids["ext_frameworks_phase"]} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids["bf_fw_replaykit_ext"]} /* ReplayKit.framework in Frameworks */,
				{ids["bf_fw_vision_ext"]} /* Vision.framework in Frameworks */,
				{ids["bf_fw_uikit_ext"]} /* UIKit.framework in Frameworks */,
				{ids["bf_fw_coreimage_ext"]} /* CoreImage.framework in Frameworks */,
				{ids["bf_fw_videotoolbox_ext"]} /* VideoToolbox.framework in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		{ids["main_group"]} = {{
			isa = PBXGroup;
			children = (
				{ids["app_group"]} /* BhekaAgent */,
				{ids["ext_group"]} /* BhekaBroadcastExtension */,
				{ids["f_app_infoplist"]} /* Info.plist */,
				{ids["f_ext_infoplist"]} /* BhekaBroadcastExtension-Info.plist */,
				{ids["frameworks_group"]} /* Frameworks */,
				{ids["products_group"]} /* Products */,
			);
			sourceTree = "<group>";
		}};
		{ids["products_group"]} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{ids["product_app"]} /* BhekaAgent.app */,
				{ids["product_ext"]} /* BhekaBroadcastExtension.appex */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
		{ids["frameworks_group"]} /* Frameworks */ = {{
			isa = PBXGroup;
			children = (
				{ids["fw_replaykit_app"]} /* ReplayKit.framework */,
				{ids["fw_vision_app"]} /* Vision.framework */,
				{ids["fw_avfoundation_app"]} /* AVFoundation.framework */,
				{ids["fw_uikit_app"]} /* UIKit.framework */,
				{ids["fw_swiftui_app"]} /* SwiftUI.framework */,
				{ids["fw_corimage_app"]} /* CoreImage.framework */,
				{ids["fw_videotoolbox_app"]} /* VideoToolbox.framework */,
			);
			name = Frameworks;
			sourceTree = "<group>";
		}};
		{ids["app_group"]} /* BhekaAgent */ = {{
			isa = PBXGroup;
			children = (
				{ids["f_app_swift"]} /* BhekaAgentApp.swift */,
				{ids["f_contentview_swift"]} /* ContentView.swift */,
				{ids["f_config_swift"]} /* Config.swift */,
				{ids["f_apiclient_swift"]} /* ApiClient.swift */,
				{ids["f_screencapture_swift"]} /* ScreenCaptureManager.swift */,
				{ids["f_appusage_swift"]} /* AppUsageTracker.swift */,
				{ids["f_ocr_swift"]} /* OCRProcessor.swift */,
				{ids["f_imageproc_swift"]} /* ImageProcessor.swift */,
				{ids["f_qrscanner_swift"]} /* QRScanner.swift */,
				{ids["f_app_entitlements"]} /* BhekaAgent.entitlements */,
				{ids["app_assets_group"]} /* Assets.xcassets */,
				{ids["app_preview_group"]} /* Preview Content */,
			);
			path = BhekaAgent;
			sourceTree = "<group>";
		}};
		{ids["app_assets_group"]} /* Assets.xcassets */ = {{
			isa = PBXGroup;
			children = (
				{ids["f_app_assets"]} /* Assets.xcassets */,
			);
			sourceTree = "<group>";
			name = "Resources";
		}};
		{ids["app_preview_group"]} /* Preview Content */ = {{
			isa = PBXGroup;
			children = (
				{ids["f_app_preview_assets"]} /* Preview Assets.xcassets */,
			);
			path = "Preview Content";
			sourceTree = "<group>";
		}};
		{ids["ext_group"]} /* BhekaBroadcastExtension */ = {{
			isa = PBXGroup;
			children = (
				{ids["f_ext_samplehandler_swift"]} /* SampleHandler.swift */,
				{ids["f_ext_apiclient_swift"]} /* ExtensionApiClient.swift */,
				{ids["f_ext_entitlements"]} /* BhekaBroadcastExtension.entitlements */,
			);
			path = BhekaBroadcastExtension;
			sourceTree = "<group>";
		}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		{ids["target_app"]} /* BhekaAgent */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {ids["app_cfg_list"]} /* Build configuration list for PBXNativeTarget "BhekaAgent" */;
			buildPhases = (
				{ids["app_sources_phase"]} /* Sources */,
				{ids["app_frameworks_phase"]} /* Frameworks */,
				{ids["app_resources_phase"]} /* Resources */,
				{ids["app_embed_extensions_phase"]} /* Embed Foundation Extensions */,
			);
			buildRules = (
			);
			dependencies = (
				{ids["target_dependency"]} /* PBXTargetDependency */,
			);
			name = BhekaAgent;
			productName = BhekaAgent;
			productReference = {ids["product_app"]} /* BhekaAgent.app */;
			productType = "com.apple.product-type.application";
		}};
		{ids["target_ext"]} /* BhekaBroadcastExtension */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {ids["ext_cfg_list"]} /* Build configuration list for PBXNativeTarget "BhekaBroadcastExtension" */;
			buildPhases = (
				{ids["ext_sources_phase"]} /* Sources */,
				{ids["ext_frameworks_phase"]} /* Frameworks */,
				{ids["ext_resources_phase"]} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = BhekaBroadcastExtension;
			productName = BhekaBroadcastExtension;
			productReference = {ids["product_ext"]} /* BhekaBroadcastExtension.appex */;
			productType = "com.apple.product-type.app-extension";
		}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		{ids["project"]} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1520;
				LastUpgradeCheck = 1520;
				TargetAttributes = {{
					{ids["target_app"]} = {{
						CreatedOnToolsVersion = 15.2;
						DevelopmentTeam = "{DEVELOPMENT_TEAM_PLACEHOLDER}";
						ProvisioningStyle = Automatic;
					}};
					{ids["target_ext"]} = {{
						CreatedOnToolsVersion = 15.2;
						DevelopmentTeam = "{DEVELOPMENT_TEAM_PLACEHOLDER}";
						ProvisioningStyle = Automatic;
					}};
				}};
			}};
			buildConfigurationList = {ids["proj_cfg_list"]} /* Build configuration list for PBXProject "BhekaAgent" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = {ids["main_group"]};
			productRefGroup = {ids["products_group"]} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{ids["target_app"]} /* BhekaAgent */,
				{ids["target_ext"]} /* BhekaBroadcastExtension */,
			);
		}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		{ids["app_resources_phase"]} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids["bf_app_assets"]} /* Assets.xcassets in Resources */,
				{ids["bf_app_preview_assets"]} /* Preview Assets.xcassets in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{ids["ext_resources_phase"]} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		{ids["app_sources_phase"]} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids["bf_app_swift"]} /* BhekaAgentApp.swift in Sources */,
				{ids["bf_contentview_swift"]} /* ContentView.swift in Sources */,
				{ids["bf_config_swift"]} /* Config.swift in Sources */,
				{ids["bf_apiclient_swift"]} /* ApiClient.swift in Sources */,
				{ids["bf_screencapture_swift"]} /* ScreenCaptureManager.swift in Sources */,
				{ids["bf_appusage_swift"]} /* AppUsageTracker.swift in Sources */,
				{ids["bf_ocr_swift"]} /* OCRProcessor.swift in Sources */,
				{ids["bf_imageproc_swift"]} /* ImageProcessor.swift in Sources */,
				{ids["bf_qrscanner_swift"]} /* QRScanner.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{ids["ext_sources_phase"]} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids["bf_ext_samplehandler_swift"]} /* SampleHandler.swift in Sources */,
				{ids["bf_ext_apiclient_swift"]} /* ExtensionApiClient.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXSourcesBuildPhase section */

/* Begin PBXTargetDependency section */
		{ids["target_dependency"]} /* PBXTargetDependency */ = {{
			isa = PBXTargetDependency;
			target = {ids["target_ext"]} /* BhekaBroadcastExtension */;
			targetProxy = {ids["container_item_proxy"]} /* PBXContainerItemProxy */;
		}};
/* End PBXTargetDependency section */

/* Begin XCBuildConfiguration section */
		{ids["proj_cfg_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ANALYZER_NONNULL = YES;
				CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
				CLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				CLANG_ENABLE_OBJC_WEAK = YES;
				CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
				CLANG_WARN_BOOL_CONVERSION = YES;
				CLANG_WARN_COMMA = YES;
				CLANG_WARN_CONSTANT_CONVERSION = YES;
				CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
				CLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
				CLANG_WARN_DOCUMENTATION_COMMENTS = YES;
				CLANG_WARN_EMPTY_BODY = YES;
				CLANG_WARN_ENUM_CONVERSION = YES;
				CLANG_WARN_INFINITE_RECURSION = YES;
				CLANG_WARN_INT_CONVERSION = YES;
				CLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
				CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
				CLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
				CLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
				CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
				CLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
				CLANG_WARN_STRICT_PROTOTYPES = YES;
				CLANG_WARN_SUSPICIOUS_MOVE = YES;
				CLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
				CLANG_WARN_UNREACHABLE_CODE = YES;
				CLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_TESTABILITY = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				GCC_DYNAMIC_NO_PIC = NO;
				GCC_NO_COMMON_BLOCKS = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				GCC_PREPROCESSOR_DEFINITIONS = (
					"DEBUG=1",
					"$(inherited)",
				);
				GCC_WARN_64_TO_32_BIT_CONVERSION = YES;
				GCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
				GCC_WARN_UNDECLARED_SELECTOR = YES;
				GCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
				GCC_WARN_UNUSED_FUNCTION = YES;
				GCC_WARN_UNUSED_VARIABLE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
				MTL_FAST_MATH = YES;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 5.0;
			}};
			name = Debug;
		}};
		{ids["proj_cfg_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ANALYZER_NONNULL = YES;
				CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
				CLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				CLANG_ENABLE_OBJC_WEAK = YES;
				CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
				CLANG_WARN_BOOL_CONVERSION = YES;
				CLANG_WARN_COMMA = YES;
				CLANG_WARN_CONSTANT_CONVERSION = YES;
				CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
				CLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
				CLANG_WARN_DOCUMENTATION_COMMENTS = YES;
				CLANG_WARN_EMPTY_BODY = YES;
				CLANG_WARN_ENUM_CONVERSION = YES;
				CLANG_WARN_INFINITE_RECURSION = YES;
				CLANG_WARN_INT_CONVERSION = YES;
				CLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
				CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
				CLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
				CLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
				CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
				CLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
				CLANG_WARN_STRICT_PROTOTYPES = YES;
				CLANG_WARN_SUSPICIOUS_MOVE = YES;
				CLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
				CLANG_WARN_UNREACHABLE_CODE = YES;
				CLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				GCC_NO_COMMON_BLOCKS = YES;
				GCC_WARN_64_TO_32_BIT_CONVERSION = YES;
				GCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
				GCC_WARN_UNDECLARED_SELECTOR = YES;
				GCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
				GCC_WARN_UNUSED_FUNCTION = YES;
				GCC_WARN_UNUSED_VARIABLE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				MTL_ENABLE_DEBUG_INFO = NO;
				MTL_FAST_MATH = YES;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_OPTIMIZATION_LEVEL = "-O";
				SWIFT_VERSION = 5.0;
				VALIDATE_PRODUCT = YES;
			}};
			name = Release;
		}};
		{ids["app_cfg_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				CODE_SIGN_ENTITLEMENTS = BhekaAgent/BhekaAgent.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_ASSET_PATHS = "\\"BhekaAgent/Preview Content\\"";
				DEVELOPMENT_TEAM = "{DEVELOPMENT_TEAM_PLACEHOLDER}";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Info.plist;
				INFOPLIST_KEY_CFBundleDisplayName = "Bheka Agent";
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0.0;
				PRODUCT_BUNDLE_IDENTIFIER = io.bheka.agent;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{ids["app_cfg_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				CODE_SIGN_ENTITLEMENTS = BhekaAgent/BhekaAgent.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_ASSET_PATHS = "\\"BhekaAgent/Preview Content\\"";
				DEVELOPMENT_TEAM = "{DEVELOPMENT_TEAM_PLACEHOLDER}";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Info.plist;
				INFOPLIST_KEY_CFBundleDisplayName = "Bheka Agent";
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0.0;
				PRODUCT_BUNDLE_IDENTIFIER = io.bheka.agent;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
		{ids["ext_cfg_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = BhekaBroadcastExtension/BhekaBroadcastExtension.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "{DEVELOPMENT_TEAM_PLACEHOLDER}";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = "BhekaBroadcastExtension-Info.plist";
				INFOPLIST_KEY_CFBundleDisplayName = "Bheka Monitoring";
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.0.0;
				PRODUCT_BUNDLE_IDENTIFIER = io.bheka.agent.BhekaBroadcastExtension;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{ids["ext_cfg_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = BhekaBroadcastExtension/BhekaBroadcastExtension.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "{DEVELOPMENT_TEAM_PLACEHOLDER}";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = "BhekaBroadcastExtension-Info.plist";
				INFOPLIST_KEY_CFBundleDisplayName = "Bheka Monitoring";
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.0.0;
				PRODUCT_BUNDLE_IDENTIFIER = io.bheka.agent.BhekaBroadcastExtension;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		{ids["proj_cfg_list"]} /* Build configuration list for PBXProject "BhekaAgent" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids["proj_cfg_debug"]} /* Debug */,
				{ids["proj_cfg_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{ids["app_cfg_list"]} /* Build configuration list for PBXNativeTarget "BhekaAgent" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids["app_cfg_debug"]} /* Debug */,
				{ids["app_cfg_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{ids["ext_cfg_list"]} /* Build configuration list for PBXNativeTarget "BhekaBroadcastExtension" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids["ext_cfg_debug"]} /* Debug */,
				{ids["ext_cfg_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
/* End XCConfigurationList section */
	}};
	rootObject = {ids["project"]} /* Project object */;
}}
'''

with open("/home/user/workspace/mobile/ios/BhekaAgent.xcodeproj/project.pbxproj", "w") as f:
    f.write(pbxproj)

print("Generated project.pbxproj successfully.")
print(f"Project object count check: {len(ids)} unique IDs allocated.")
