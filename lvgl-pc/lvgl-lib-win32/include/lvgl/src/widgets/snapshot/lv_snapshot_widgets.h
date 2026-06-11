/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * @file lv_snapshot_widgets.h
 *
 */


#ifndef LV_SNAPSHOT_WIDGETS_H
#define LV_SNAPSHOT_WIDGETS_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../lv_conf_internal.h"

#if LV_USE_SNAPSHOT
#if LV_USE_SNAPSHOT_WIDGETS != 0

#include "../../core/lv_obj.h"
#include "../image/lv_image.h"
#include "../../core/lv_obj_private.h"
#include "../../others/snapshot/lv_snapshot.h"

/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/
/*Data of snapshot_widgetsate*/
typedef struct {
    lv_obj_t obj;
    lv_obj_t *snapshot;
    lv_color_t bg_color;
    lv_color_format_t snapshot_format;
    bool need_redraw;
    bool update_running;
    bool reschedule;
    bool use_jpeg;
} lv_snapshot_widgets_t;

LV_ATTRIBUTE_EXTERN_DATA extern const lv_obj_class_t lv_snapshot_widgets_class;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**
 * @brief Create a snapshot_widgets object
 * @param parent pointer to an object, it will be the parent of the new snapshot_widgets
 * @return pointer to the created snapshot_widgets
 */
lv_obj_t * lv_snapshot_widgets_create(lv_obj_t * parent);

/**
 * @brief Trigger an immediate snapshot refresh.
 * @param obj Pointer to the snapshot_widgets object.
 * @note Executes synchronously in the current context; use for immediate updates.
 */
void lv_snapshot_widgets_update(lv_obj_t *obj);

/**
 * @brief Request an asynchronous snapshot update.
 * @param obj Pointer to the snapshot_widgets object.
 * @note Enqueues a single async task; coalesces multiple requests; not executed immediately.
 */
void lv_snapshot_widgets_need_update(lv_obj_t *obj);

/*======================
 * Add/remove functions
 *=====================*/

/*=====================
 * Setter functions
 *====================*/

/**
 * @brief Set the snapshot format of the snapshot_widgets
 *
 * @param obj pointer to the snapshot_widgets object
 * @param cf the snapshot format to set
 */
void lv_snapshot_widgets_set_snapshot_format(lv_obj_t *obj, lv_color_format_t cf);

/**
 * @brief Set the use_jpeg flag of the snapshot_widgets
 *
 * @param obj pointer to the snapshot_widgets object
 * @param use_jpeg the use_jpeg flag to set
 */
void lv_snapshot_widgets_use_jpeg(lv_obj_t *obj, bool use_jpeg);

/**
 * @brief Set the bg_color of the snapshot_widgets
 *
 * @param obj pointer to the snapshot_widgets object
 * @param bg_color the bg_color to set
 */
void lv_snapshot_widgets_set_bg_color(lv_obj_t *obj, lv_color_t bg_color);

/*=====================
 * Getter functions
 *====================*/

/**
 * @brief Get the snapshot format of the snapshot_widgets
 *
 * @param obj pointer to the snapshot_widgets object
 * @return lv_color_format_t the snapshot format of the snapshot_widgets
 */
lv_color_format_t lv_snapshot_widgets_get_snapshot_format(lv_obj_t *obj);

/*=====================
 * Other functions
 *====================*/

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_SNAPSHOT_WIDGETS*/

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_SNAPSHOT_WIDGETS_H*/
#endif /*LV_USE_SNAPSHOT*/
