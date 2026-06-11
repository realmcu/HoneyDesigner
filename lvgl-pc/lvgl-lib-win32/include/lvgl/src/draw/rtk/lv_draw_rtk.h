/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: LicenseRef-Realtek-5-Clause
 */

/**
 * @file lv_draw_rtk.h
 *
 */

#ifndef LV_DRAW_RTK_H
#define LV_DRAW_RTK_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../lv_draw.h"

#if LV_USE_DRAW_RTK

#include "../../misc/lv_area.h"
#include "../../misc/lv_color.h"
#include "../../display/lv_display.h"
#include "../../osal/lv_os.h"

#include "../lv_draw_rect.h"
#include "../lv_draw_image.h"
#include "../sw/lv_draw_sw_utils.h"
#include "../lv_draw_label.h"

/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/

typedef lv_draw_sw_unit_t lv_draw_rtk_unit_t;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

void lv_draw_rtk_init(void);

void lv_draw_rtk_deinit(void);

/**
 * Draw a label with RTK render.
 * @param t             draw task
 * @param dsc           the draw descriptor
 * @param coords        the coordinates of the label
 */
void lv_draw_rtk_label(lv_draw_task_t * t, const lv_draw_label_dsc_t *dsc,
                       const lv_area_t *coords);

/**
 * Draw an image with RTK render.
 * @param t             draw task
 * @param dsc           the draw descriptor
 * @param coords        the coordinates of the image
 */
void lv_draw_rtk_image(lv_draw_task_t * t, const lv_draw_image_dsc_t *dsc,
                       const lv_area_t *coords);

/**
 * Draw a layer with RTK render.
 * @param t             draw task
 * @param dsc           the draw descriptor
 * @param coords        the coordinates of the layer
 */
void lv_draw_rtk_layer(lv_draw_task_t * t, const lv_draw_image_dsc_t *dsc,
                       const lv_area_t *coords);



/***********************
 * GLOBAL VARIABLES
 ***********************/

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_RTK*/

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_DRAW_RTK_H*/
