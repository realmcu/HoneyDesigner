/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: LicenseRef-Realtek-5-Clause
 */

/**
 * @file lv_draw_ppe.h
 *
 */

#ifndef LV_DRAW_PPE_H
#define LV_DRAW_PPE_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../lv_draw.h"
#if LV_USE_DRAW_PPE_RTL8773G

#include "../../../misc/lv_area.h"
#include "../../../misc/lv_color.h"
#include "../../../display/lv_display.h"
#include "../../../osal/lv_os.h"

#include "../../lv_draw_rect.h"
#include "../../lv_draw_image.h"
#include "lv_ppe_rtl8773g_utils.h"
#include "../../sw/lv_draw_sw_utils.h"

/*********************
 *      DEFINES
 *********************/
#if LV_USE_DRAW_SW_ASM == LV_DRAW_SW_ASM_CUSTOM
#define LV_USE_PPE_BLEND 1
#endif
/**********************
 *      TYPEDEFS
 **********************/

typedef lv_draw_sw_unit_t lv_draw_ppe_unit_t;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

void lv_draw_ppe_init(void);
void lv_draw_ppe_support_init(void);

void lv_draw_ppe_deinit(void);
void lv_draw_ppe_support_deinit(void);
void lv_draw_ppe_fill(lv_draw_task_t *t, lv_draw_fill_dsc_t *dsc, const lv_area_t *coords);

void lv_draw_ppe_image(lv_draw_task_t *t, const lv_draw_image_dsc_t *draw_dsc,
                       const lv_area_t *coords);

void lv_draw_ppe_layer(lv_draw_task_t *t, const lv_draw_image_dsc_t *draw_dsc,
                       const lv_area_t *coords);

void lv_draw_ppe_box_shadow(lv_draw_task_t *t, const lv_draw_box_shadow_dsc_t *dsc,
                            const lv_area_t *coords);

void lv_draw_ppe_label(lv_draw_task_t *t, const lv_draw_label_dsc_t *dsc,
                       const lv_area_t *coords);
void lv_draw_ppe_mask_rect(lv_draw_task_t *t, const lv_draw_mask_rect_dsc_t *dsc,
                           const lv_area_t *coords);
#if LV_DRAW_TRANSFORM_USE_MATRIX
void lv_draw_ppe_image_use_matrix(lv_draw_task_t *t, const lv_draw_image_dsc_t *draw_dsc,
                                  const lv_area_t *coords, lv_matrix_t *matrix, uint32_t mode);
void lv_draw_ppe_layer_use_matrix(lv_draw_task_t *t, const lv_draw_image_dsc_t *draw_dsc,
                                  const lv_area_t *coords);
#endif
/***********************
 * GLOBAL VARIABLES
 ***********************/

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_PPE*/

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_DRAW_PPE_H*/
