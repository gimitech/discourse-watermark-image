import { setOwner } from "@ember/owner";
import { service } from "@ember/service";
import { withPluginApi } from "discourse/lib/plugin-api";
import { isImage } from "discourse/lib/uploads";
import { bind } from "discourse-common/utils/decorators";
import { i18n } from "discourse-i18n";
import { imageDataToFile } from "../lib/media-watermark-utils";
import { imagesExtensions } from "../lib/uploads";
import UppyMediaWatermark from "../lib/uppy-media-watermark-plugin";
import Watermark, { isImageAllowed } from "../lib/watermark";

class WatermarkInit {
  @service currentUser;

  constructor(owner, api) {
    setOwner(this, owner);
    this.api = api;

    api.addComposerUploadPreProcessor(
      UppyMediaWatermark,
      ({ composerModel, isMobileDevice }) => {
        return {
          watermarkFn: async (file) => {
            if (owner.isDestroyed || owner.isDestroying) {
              return null;
            }

            const fileNameLowered = file.name.toLowerCase();

            if (!isImage(fileNameLowered)) {
              return null;
            }

            if (!isImageAllowed(fileNameLowered)) {
              return null;
            }

            if (
              !settings.watermark_image &&
              !settings.watermark_qrcode_enabled
            ) {
              return null;
            }

            if (
              settings.watermark_categories &&
              !settings.watermark_categories
                .split("|")
                .map((c) => Number(c))
                .includes(composerModel.categoryId)
            ) {
              return null;
            }

            if (settings.watermark_groups) {
              const requiredGroups = settings.watermark_groups
                .split("|")
                .map((g) => Number(g));

              if (
                !requiredGroups.includes(0) &&
                !this.currentUser.visibleGroups
                  .map((group) => group.id)
                  .some((group) => requiredGroups.includes(group))
              ) {
                return null;
              }
            }

            let topicData = null;

            if (composerModel.topic) {
              topicData = {
                id: composerModel.topic?.id,
                title: composerModel.topic?.title,
                url: composerModel.topic?.url,
              };
            }

            const watermark = new Watermark(owner, file.data, {
              topic: topicData,
            });

            const imageData = await watermark.process();

            if (!imageData) {
              return null;
            }

            const watermarkFile = await imageDataToFile(imageData, {
              fileName: file.name,
              fileType: file.type,
            });

            return Promise.resolve(watermarkFile);
          },
          runParallel: !isMobileDevice,
        };
      }
    );

    if (!settings.watermark_allow_non_supported_uploads) {
      api.modifyClass(
        "component:composer-editor",
        (Superclass) =>
          class extends Superclass {
            @service dialog;
            @service currentUser;
            @service siteSettings;

            @bind
            setupEditor(textManipulation) {
              const result = super.setupEditor(textManipulation);

              const { uppyInstance } = this.uppyComposerUpload.uppyWrapper;
              const originalHandler = uppyInstance.opts.onBeforeFileAdded;
              uppyInstance.opts.onBeforeFileAdded = (currentFile) => {
                if (
                  originalHandler &&
                  isImage(currentFile.name.toLowerCase())
                ) {
                  const {
                    pattern: regexPattern,
                    extensions: commonExtensions,
                  } = Watermark.getExtensionsRegex(
                    imagesExtensions(this.currentUser?.staff, this.siteSettings)
                  );

                  if (!regexPattern.test(currentFile.type)) {
                    this.dialog.alert(
                      i18n(
                        themePrefix("composer.errors.upload_not_authorized"),
                        {
                          authorized_extensions: commonExtensions.join(", "),
                        }
                      )
                    );
                    return false;
                  }
                }

                return originalHandler;
              };

              return result;
            }
          }
      );
    }
  }
}

export default {
  name: "discourse-watermark",

  initialize(owner) {
    withPluginApi("1.38.0", (api) => {
      this.instance = new WatermarkInit(owner, api);
    });
  },

  tearDown() {
    this.instance = null;
  },
};
